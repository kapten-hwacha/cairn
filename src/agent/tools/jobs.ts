import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { serverExecute } from "../tool-execute.ts";
import {
  isPlot3DInput,
  type JobRecord,
  type PlotToolInput,
} from "../../core/contracts.ts";
import type { JobStore } from "../../core/ports.ts";
import { checkLearnerImage } from "./learner-image.ts";
import { resolveSourcePath } from "./fs-shared.ts";

/**
 * Async sub-agent job tools (vision §2.5; W2/W6 kinds + the pi-model
 * protocol). SERVER-EXECUTED: each call creates the job record, fires the
 * background runner (via the injected spawn seam — the agent layer never
 * imports one), and resolves IMMEDIATELY with a fire-and-forget ack. The
 * teacher's turn does NOT end at the call; the result arrives later as a
 * steer message that wakes the teacher in a new turn. See contracts.ts
 * "THE ASYNC PROTOCOL".
 */

/** What the job tools need at execute time (injected by the composition root). */
export interface JobToolContext {
  chatId: string;
  /** Creates the job record (deduped by toolCallId). */
  jobStore: JobStore;
  /** Fire the background runner for a fresh job — fire-and-forget. The
   *  input rides along because the spawn happens MID-STREAM, before
   *  onFinish persists the tool part — a transcript scan would race it. */
  spawn: (
    job: JobRecord,
    input: ResearchInput | DemoInput | VisualInput | PdfInput | PlotToolInput,
  ) => void;
  /** Search-provider availability, retained for existing composition seams.
   *  Research dispatch does not depend on it: web_fetch is keyless and
   *  web_search reports a missing provider as a recoverable tool result. */
  searchAvailable?: () => boolean;
}

export const researchInputSchema = Type.Object({
  question: Type.String({
    description:
      "The single research question to answer. Make it specific — the researcher sees nothing else of the lesson.",
  }),
  context: Type.Optional(
    Type.String({
      description:
        "Why you need this / what the lesson needs it for — focuses the brief. One or two sentences.",
    }),
  ),
});

export const demoInputSchema = Type.Object({
  title: Type.String({
    description:
      "Short title for the demo card, e.g. 'Damped harmonic oscillator'.",
  }),
  brief: Type.String({
    description:
      "Precise brief for the builder: the concept, the parameters/controls and what each does, the interactions, and the visual style. " +
      "The builder sees NOTHING else of the lesson — include everything it needs, including necessary formulas and constants.",
  }),
});

export const visualInputSchema = Type.Object({
  brief: Type.String({
    description:
      "Precise brief for ONE static figure: exactly what it must show — coordinates, labels, proportions, orientation. " +
      "The maker sees NOTHING else of the lesson; a wrong or vague brief produces a wrong figure. " +
      "With an image: which features to mark and what each label says.",
  }),
  image: Type.Optional(
    Type.String({
      description:
        "Path to one of the learner's image files (jpg, png, gif, webp, bmp) to annotate — the maker draws on top of it " +
        "instead of drawing from scratch.",
    }),
  ),
});

// DeepSeek requires an object-valued `items`; Type.Tuple emits an array of
// schemas. Keep the tuple contract while enforcing its length at runtime.
const plotDomainSchema = Type.Unsafe<PlotToolInput["xDomain"]>(
  Type.Array(Type.Number(), { minItems: 2, maxItems: 2 }),
);
const plotCurveIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "\\S",
});
const plotAnnotationSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Optional(Type.Literal("point")),
      x: Type.Number(),
      y: Type.Number(),
      label: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("note"),
      x: Type.Number(),
      y: Type.Number(),
      label: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("curve-point"),
      curveId: plotCurveIdSchema,
      x: Type.Number(),
      label: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("level-crossing"),
      curveId: plotCurveIdSchema,
      level: Type.String(),
      xBracket: plotDomainSchema,
      label: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

const plot2DInputSchema = Type.Object({
  xLabel: Type.String(),
  xScale: Type.Union([Type.Literal("linear"), Type.Literal("log")]),
  xDomain: plotDomainSchema,
  panels: Type.Array(
    Type.Object({
      title: Type.String(),
      xDomain: Type.Optional(
        Type.Unsafe<PlotToolInput["xDomain"]>(
          Type.Array(Type.Number(), {
            minItems: 2,
            maxItems: 2,
            description:
              "Optional x-axis domain for this panel; overrides the plot-level xDomain. Use it for a zoomed view.",
          }),
        ),
      ),
      yLabel: Type.String(),
      yScale: Type.Union([Type.Literal("linear"), Type.Literal("log")]),
      yDomain: Type.Optional(plotDomainSchema),
      curves: Type.Array(
        Type.Object({
          id: Type.Optional(plotCurveIdSchema),
          label: Type.String(),
          expression: Type.Optional(Type.String()),
          xDomain: Type.Optional(plotDomainSchema),
          sampleAt: Type.Optional(Type.Array(Type.Number(), { maxItems: 128 })),
          points: Type.Optional(
            Type.Array(Type.Object({ x: Type.Number(), y: Type.Number() })),
          ),
        }),
      ),
      annotations: Type.Optional(
        Type.Array(plotAnnotationSchema, { maxItems: 40 }),
      ),
    }),
  ),
});

const text3D = Type.String({ minLength: 1, maxLength: 160 });
const seed3D = Type.Optional(Type.Array(Type.Number(), { maxItems: 16 }));
const plot3DInputSchema = Type.Object(
  {
    kind: Type.Literal("3d"),
    title: text3D,
    xLabel: Type.String({ minLength: 1, maxLength: 2048 }),
    yLabel: Type.String({ minLength: 1, maxLength: 2048 }),
    zLabel: Type.String({ minLength: 1, maxLength: 2048 }),
    xDomain: plotDomainSchema,
    yDomain: plotDomainSchema,
    zDomain: plotDomainSchema,
    series: Type.Array(
      Type.Union([
        Type.Object(
          {
            kind: Type.Literal("surface"),
            label: text3D,
            expression: Type.String({ minLength: 1, maxLength: 2048 }),
            xDomain: Type.Optional(plotDomainSchema),
            yDomain: Type.Optional(plotDomainSchema),
            sampleAtX: seed3D,
            sampleAtY: seed3D,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("parametric"),
            label: text3D,
            xExpression: Type.String({ minLength: 1, maxLength: 2048 }),
            yExpression: Type.String({ minLength: 1, maxLength: 2048 }),
            zExpression: Type.String({ minLength: 1, maxLength: 2048 }),
            uDomain: plotDomainSchema,
            sampleAtU: seed3D,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("scatter"),
            label: text3D,
            points: Type.Array(
              Type.Object(
                { x: Type.Number(), y: Type.Number(), z: Type.Number() },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 10000 },
            ),
          },
          { additionalProperties: false },
        ),
      ]),
      { minItems: 1, maxItems: 4 },
    ),
  },
  { additionalProperties: false },
);
// Anthropic drops root unions. Expose useful object properties to every provider;
// enforce the selected complete branch again before any job is created.
const plotInputSchema = Type.Unsafe<PlotToolInput>(
  Type.Object(
    Object.fromEntries(
      Object.entries({
        ...plot3DInputSchema.properties,
        ...plot2DInputSchema.properties,
      }).map(([name, schema]) => [
        name,
        name === "xLabel" || name === "xDomain"
          ? schema
          : Type.Optional(schema),
      ]),
    ),
  ),
);
export function validatePlotToolInput(input: unknown): PlotToolInput {
  return validateToolArguments(
    {
      name: "plot",
      description: "Deterministic plot input",
      parameters: isPlot3DInput(input) ? plot3DInputSchema : plot2DInputSchema,
    },
    {
      type: "toolCall",
      id: "plot-validation",
      name: "plot",
      arguments: input as ToolCall["arguments"],
    },
  ) as PlotToolInput;
}

export const pdfInputSchema = Type.Object({
  path: Type.String({
    description:
      "Path to the learner's PDF (relative or absolute), exactly as they gave it.",
  }),
  question: Type.String({
    description:
      "What you need from the document — the specific content, explanation, or answer to extract and brief. " +
      "The reader sees NOTHING else of the lesson.",
  }),
});

/**
 * The per-call dispatch: create the job (idempotent by toolCallId), fire the
 * runner, and return the ack. Shared by all three tools — only kind differs.
 */
async function dispatch(
  ctx: JobToolContext,
  kind: JobRecord["kind"],
  toolCallId: string,
  ack: string,
  input: ResearchInput | DemoInput | VisualInput | PdfInput | PlotToolInput,
): Promise<string> {
  const existing = await ctx.jobStore.findJobByToolCallId(
    ctx.chatId,
    toolCallId,
  );
  const job =
    existing ??
    (await ctx.jobStore.createJob({
      kind,
      chatId: ctx.chatId,
      toolCallId,
      input,
    }));
  if (!existing) ctx.spawn(job, input);
  return `Dispatched (job ${job.id}). ${ack}`;
}

const RESEARCH_ACK =
  "This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
  "The researched brief arrives as a new message when ready and the lesson resumes from it; cite its sources when you use them.";
const DEMO_ACK =
  "This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
  "The tested demo arrives as a new message when ready and is rendered in the lesson; teach with it then.";
const VISUAL_ACK =
  "This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
  "The verified figure arrives as a new message when ready and is rendered in the lesson; reference it then.";
const PDF_ACK =
  "This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
  "The document brief arrives as a new message when ready; weave it into the lesson and cite its pages.";

const RESEARCH_DESCRIPTION =
  "Dispatch a background web-research agent: fact verification, current data, or niche specifics you are not certain about. " +
  "The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the research brief arrives later " +
  "as a new message and the lesson resumes from it. Cite the brief's sources when you use them. " +
  "NEVER use it for things you know cold, internal reasoning, or math.";
const DEMO_DESCRIPTION =
  "Dispatch a background sub-agent that BUILDS and headlessly TESTS an interactive teaching instrument — a single-file HTML " +
  "demo (parameter sweep, simulation, animation, sampling) rendered live in the lesson. Use it when the concept is DYNAMIC: " +
  "something to sweep, animate, or sample is better experienced than described. " +
  "The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the tested demo arrives later " +
  "as a new message. Write a precise brief: concept, controls, interactions, style.";
const VISUAL_DESCRIPTION =
  "Dispatch a background sub-agent that hand-authors ONE precise SVG figure, renders it, LOOKS at the render, and iterates " +
  "until correct. Use it for exact spatial pictures auto-layout diagrams can't do: coordinate geometry, number lines, vectors, " +
  "physical layouts. Use plot for numerical graphs. For flows/relations/taxonomies write mermaid inline instead. " +
  "Pass `image` (a learner image file) to have the maker annotate that picture — arrows, outlines, labels — instead. Local image paths follow File access settings; use ls to discover allowed folders. " +
  "The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the verified figure arrives later " +
  "as a new message.";
const PDF_DESCRIPTION =
  "Dispatch a background sub-agent that READS a learner-provided PDF on your behalf (triage, targeted extraction, visual page " +
  "reading for equations and diagrams) and returns a brief with page citations. Use it when the learner gives you a PDF path " +
  "and you need its CONTENT for the lesson. The call is ASYNC and fire-and-forget — it resolves immediately and your turn " +
  "continues; the brief arrives later as a new message. For quick looks at plain text or image files, use the read tool " +
  "directly instead of dispatching. Local PDF paths follow File access settings; use ls to discover allowed folders.";

/**
 * Per-request job tool registry: each tool closes over the composition root's
 * context (chatId + jobStore + the spawn seam), so concurrent chats never
 * share state. chat-handler wires it each turn; tests wire their own.
 *
 * Research remains available without a search-provider key; the role's
 * existing user-toggle filtering still applies outside this registry.
 */
export function jobTools(ctx: JobToolContext): Record<string, AgentTool<any>> {
  return {
    research: {
      name: "research",
      label: "research",
      description: RESEARCH_DESCRIPTION,
      parameters: researchInputSchema,
      execute: serverExecute(
        "research",
        researchInputSchema,
        async (input, { toolCallId }) =>
          dispatch(ctx, "research", toolCallId, RESEARCH_ACK, input),
      ),
    },
    demo: {
      name: "demo",
      label: "demo",
      description: DEMO_DESCRIPTION,
      parameters: demoInputSchema,
      execute: serverExecute(
        "demo",
        demoInputSchema,
        async (input, { toolCallId }) =>
          dispatch(ctx, "demo", toolCallId, DEMO_ACK, input),
      ),
    },
    visual: {
      name: "visual",
      label: "visual",
      description: VISUAL_DESCRIPTION,
      parameters: visualInputSchema,
      // An unusable image path fails the CALL (no job is created), so the
      // teacher corrects the path in the same turn.
      execute: serverExecute(
        "visual",
        visualInputSchema,
        async (input, { toolCallId, signal }) => {
          if (
            !(await ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId)) &&
            input.image !== undefined
          )
            await checkLearnerImage(input.image);
          signal?.throwIfAborted();
          return dispatch(ctx, "visual", toolCallId, VISUAL_ACK, input);
        },
      ),
    },
    plot: {
      name: "plot",
      label: "plot",
      description:
        "Create a deterministic numerical 2D or interactive 3D plot in the background. For 3D supply kind 3d, title, xLabel/yLabel/zLabel, fixed linear xDomain/yDomain/zDomain and 1–4 series. Surfaces use kind surface and expression in x,y; parametric curves use kind parametric with xExpression/yExpression/zExpression in u and uDomain; supplied data use kind scatter with finite {x,y,z} points and no connecting lines. Optional sampleAtX/sampleAtY/sampleAtU identify narrow features. 3D runtime and PNG are checked before delivery. Standard 3D rotation and zoom use plot, not demo; time animation is not supported by this branch. Supply panels and curves as numeric points or expressions in x. Expressions support +, -, *, /, ^, parentheses, pi, e, sin, cos, tan, asin, acos, atan, atan2, sqrt, abs, log, log10, exp. Use logarithmic x scale for frequency plots. The generated SVG is delivered to the lesson; check equations independently. Write every formula and mathematical symbol in titles, axis labels, legends and annotations using $...$; keep explanatory prose outside the delimiters. For example: $y=x^2-4$, $x$ (s), and vertex $(0,-4)$. Keep numeric expressions in the expression grammar, without LaTeX delimiters. For a known analytic function, supply an expression rather than invented sample points; reserve points for supplied or measured data. At discontinuities, split expressions into separate curves with non-crossing xDomain intervals. Use sampleAt for important narrow features. For numerical plots use plot, including 3D rotation/zoom; use demo for custom controls or time evolution. Panels inherit the plot-level xDomain by default; set a panel's xDomain for an independent range, such as a zoomed view. For annotations on analytic curves, give the curve a unique id and use kind curve-point with curveId and x, or kind level-crossing with curveId, a constant level expression such as exp(-1), and xBracket isolating one crossing on a continuous branch. The renderer computes coordinates and appends their values; keep label descriptive and do not repeat manually calculated coordinates. Use kind note with x, y and label for explanatory text that is not a data point. Explicit point coordinates are for supplied or measured points. Narrow the bracket if a crossing cannot be resolved.",
      parameters: plotInputSchema,
      execute: serverExecute(
        "plot",
        plotInputSchema,
        async (input, { toolCallId }) =>
          dispatch(
            ctx,
            "plot",
            toolCallId,
            "The plot arrives in the lesson when ready.",
            validatePlotToolInput(input),
          ),
      ),
    },
    pdf: {
      name: "pdf",
      label: "pdf",
      description: PDF_DESCRIPTION,
      parameters: pdfInputSchema,
      execute: serverExecute(
        "pdf",
        pdfInputSchema,
        async (input, { toolCallId }) => {
          // Admission uses the current boundary; the queued reader checks
          // again at job start. Preserve raw args/history and replay IDs.
          if (!(await ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId)))
            resolveSourcePath(input.path);
          return dispatch(ctx, "pdf", toolCallId, PDF_ACK, input);
        },
      ),
    },
  };
}

export type ResearchInput = Static<typeof researchInputSchema>;
export type DemoInput = Static<typeof demoInputSchema>;
export type VisualInput = Static<typeof visualInputSchema>;
export type PdfInput = Static<typeof pdfInputSchema>;
