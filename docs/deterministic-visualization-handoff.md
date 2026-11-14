# Deterministic visualization: implementation handoff

**Current status (2026-11-14):** the user approved the static 3D Tauri
[integration plan](plot3d-tauri-integration-plan.md) with “go ahead”. Surfaces,
parametric curves and scatter are integrated into the deterministic `plot`
tool, portable worker renderer and interactive lesson card. All 26 actual
WKWebView checks pass, including math labels, PNG capture, four-series plots,
camera preservation and unavailable WebGL. The final ARM64 app and DMG are built;
the installer checksum is valid. See the [integration report](plot3d-tauri-integration-report.md)
for current evidence. Animation, geometry and visual-agent tool expansion remain
separate increments. Historical milestone-0 discussion follows; its statements
that integration had not started describe that earlier state.

**Original handoff date:** 2026-11-12. Detailed contracts outside the approved
static 3D increment remain proposals for review.

**Goal:** make numerical plots and common explanatory diagrams reliable through
structured specifications and maintained rendering code, including interactive
3D plots and time-driven animation.

**Original next-agent instruction:** start with milestone 0. Read this document and the working tree;
do not restart the plot work or treat proposed details as approved requirements.
The user requested this handoff, not implementation in the current turn.

**Resumed milestone 0:** see the [current decision log and draft plan](deterministic-visualization-plan.md)
and [renderer feasibility investigation](deterministic-visualization-feasibility.md).
The resumed discussion approved including 3D scatter/data points, the compatible
plot/result directions, playback defaults and the initial geometry direction.
Follow-up approved whole-document demo reuse first, bounded-refinement/failure
directions, the proposed structured-tool/raw-SVG transition and drafting the
exact specification for review. The earlier Three.js recommendation was
superseded by testing Plotly's LaTeX support before deciding the backend.
Read the [focused Plotly investigation](plotly-latex-investigation.md) for the
identified seams and current measured evidence. An authorized no-fork probe now
passes offline Chrome rotation/zoom and composed exports with CSP/opaque sandbox;
raw export omits math, fixed label placement can overlap, and conversion work
repeats during drag. The user agreed to prefer a targeted native-math fork
prototype next, then approved its [concrete plan](plotly-native-math-prototype-plan.md)
with “go ahead”. That isolated prototype is complete; the full rerun
`data/visualization-review/plotly-native-math-04` passed 109/110 cases and exits 1
for one clipped title at 450x325, title size 12, device scale 2 in an opaque
sandbox. Seventeen focused tests and source checks pass. The user also
approved the fourth, deterministic CSS build patch. Two clean builds now match
byte-for-byte. A camera/layout mismatch after wheel zoom was reproduced and
the probe now synchronizes capture through `Plotly.relayout`; no axis-layout
patch was added. Native WebView and actual worker-host integration remain
unverified. No product backend has been selected and no feature integration has started.
The [title-bounds follow-up plan](plotly-native-math-title-bounds-plan.md) was
approved with “implement the title-bounds fix”. Its fifth patch is complete;
25 focused tests, all 110 runtime matrix cases and all 108 camera-sweep
observations pass. The full probe exits 0 with `passed: true`, no unexpected
page/network errors and zero native math conversions during interaction. Fresh
builds `learnharness-plotly-title-bounds-01` and `-02` match byte-for-byte.
The complete matrix/sweep/performance run is saved under
`data/visualization-review/plotly-title-bounds-01` (log:
`/private/tmp/lh-title-full-probe01.log`). All 18 timing configurations completed.
Oversized-title rejection was verified separately without a render-loop error.
Later concurrent edits in unrelated graph/UI/provider
files were preserved; final whole-project type checking hit a syntax error in
`tests/graph.test.ts`, while the prototype's focused type check passes.
The user subsequently requested that blocker be fixed: the duplicate test
declaration and stale async test calls in the graph/compaction tests are now
repaired. All 51 targeted tests and the full-project typecheck pass; production
graph behavior was not changed. Product adoption and the full visualization
implementation plan remain unapproved.

**Desktop packaging check (2026-11-14):** `npm run desktop:dist` completed
successfully, producing the ARM64 app at
`src-tauri/target/release/bundle/macos/LearnHarness.app` and installer at
`src-tauri/target/release/bundle/dmg/LearnHarness_0.5.0_aarch64.dmg`.
This packages the current app, including the completed 2D plotting changes.
The isolated Plotly fork has no production import or Vite copy step, so it is
not included in this app build. This packaging check does not close the
Plotly worker/host or native WebView integration gates.
The user clarified that the requested Tauri build must include usable 3D
plotting. The [concrete Tauri integration plan](plot3d-tauri-integration-plan.md)
now covers production tool admission, numerical preparation, portable native
math, worker/host verification, interactive display and an isolated WKWebView
smoke gate. The user approved static 3D first; this increment is implemented,
native-tested and packaged. Animation remains separate.
Detailed contracts, backend selection and final implementation approval remain
open. Fresh baseline: 224 scoped tests and six worker-adapter tests passed;
the real browser-worker test failed during Chrome startup, before rendering.
No feature implementation has started. The proposed details below retain their
original proposal status except where the current decision log records approval.

## 1. Agreed architecture and tool exposure

Keep three artifact tools visible to the teaching agent:

| Tool     | Responsibility                                                                   | Teacher supplies                                                |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `plot`   | Numerical 2D/3D graphs, including animated plots                                 | Equations/data, domains, labels and optional time specification |
| `visual` | Explanatory geometry, vectors, physical arrangements and animated constructions  | One self-contained `brief`; optional learner image              |
| `demo`   | Custom experiments, simulations and interactions beyond the structured renderers | A brief specifying behavior and controls                        |

Dimension and animation are options within these tools. Do not expose a separate
teacher tool for every primitive, dimension or animation type. Research/PDF and
other existing teacher tools are unrelated and remain available.

- Direct `plot` jobs remain deterministic and bypass sub-agent model selection.
- Give the visualization agent structured drawing tools inside its existing
  workflow. The teacher continues to call `visual({brief, image?})`.
- The visualization agent can use the same plot renderer for a numerical graph.
  This does not require another teacher dispatch or nested background job.
- Keep raw SVG for figures outside the structured renderer's supported scope.
- Preserve the visualization agent's render-and-inspect workflow. It evaluates
  composition; numerical validation supplies separate evidence about geometry.
- Allow the demo builder to reuse structured renderers for supported content;
  custom model-authored behavior continues through its existing testing loop.
- Standard rotation/zoom and animation play/pause/restart/time scrubbing were
  recommended in the accepted architecture. Exact defaults remain unapproved.

The user specifically approved keeping structured drawing inside the existing
visualization agent, then accepted the three-tool architecture above as the basis
for a handoff plan. They have not approved a library, detailed JSON schemas,
sampling budgets, prompt wording or UX defaults.

## 2. Instructions and working-tree state

Repository: `/Users/hwacha/work/personal/learnharness`.

- Read `AGENTS.md`. It requires investigating, resolving ambiguous design
  decisions with the user, and getting the concrete plan approved before coding.
  Ask one specific question per call with the available ask-user tool. Do not
  mistake this document's proposals for permission to guess remaining details.
- For nontrivial work, maintain exact paths, I/O contracts and test commands.
- Run formatter, linter and type checker on modified code; apply automatic fixes.
  Prefer `uv` for Python if Python is needed.
- Before writing Next-related code, read relevant local guides under
  `node_modules/next/dist/docs/`. Testing, package-bundling and lazy-loading guides
  were consulted while preparing this handoff; recheck those relevant to changes.
- Respect the import boundaries in `eslint.config.mjs`: core is pure;
  agent code receives storage dependencies; components import core through
  `@/src/core`, not directly from agent/server modules.
- The working tree is extensively dirty with pre-existing user work and the
  completed plot changes. Run `git status --short` and inspect relevant diffs.
  Do not reset, sweep-format unrelated files, commit, publish or clean artifacts.
- No sub-agent delegation has been authorized for this task.
- The user prefers headless verification and will review figures themselves.
  Do not expand this into desktop automation or a mandatory model vision judge.
- Model-backed agents continue using the app's role configuration. Do not hardcode
  DeepSeek into renderer code; the prior benchmark used a switchable DeepSeek
  Flash/high setting, while rendering itself makes no model calls.
- Current shell is zsh. Quote optional globs or discover paths with `rg --files`;
  unmatched shell globs fail before the command runs.

## 3. Existing implementation to build on

| Path                                                    | Current responsibility / important invariant                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/core/contracts/jobs.ts`                            | `PlotInput`, plot/visual/demo results, job protocol, failure detection and model-facing steers           |
| `src/core/contracts.ts`, `src/core/index.ts`            | Shared type/helper export surfaces; inspect before adding exports                                        |
| `src/agent/tools/jobs.ts`                               | Teacher tool schemas, validation, async dispatch and persisted input                                     |
| `src/agent/tools.ts`                                    | Teacher tool registry and spawn input types                                                              |
| `src/agent/subagents/runner.ts`                         | Direct `renderPlot` branch before model selection; visual/demo model loops; completion/delivery          |
| `src/agent/plot.ts`                                     | `renderPlot(input: PlotInput): Promise<string>`; static 2D SVG with Vega and measured labels             |
| `src/agent/plot-expression.ts`                          | Bounded AST parser/compiler; numeric grammar currently allows `x`, `pi`, `e`; no `eval`/`Function`       |
| `src/agent/plot-sampling.ts`                            | Bounded adaptive sampling, exact feature hints and discontinuity gaps                                    |
| `src/agent/plot-annotations.ts`                         | Computed curve points and bracketed level crossings; legacy explicit points and markerless notes         |
| `src/agent/plot-labels.ts`                              | MathJax glyph paths, text measurement and XML escaping; offline, font-independent SVG                    |
| `src/agent/plot-math-format.ts`                         | Conservative recognition of unmarked formulas; explicit math markup still preferred                      |
| `src/agent/plot-layout.ts`                              | Label collision checks against points/segments, leaders and overflow                                     |
| `src/agent/subagents/visual-maker.ts`                   | Raw `write_svg`, `edit_svg`, `render_svg`; final image must be supplied to a later model call            |
| `src/agent/subagents/annotation-svg.ts`                 | Learner-image placement/static markup protocol; does not establish feature-location accuracy             |
| `src/agent/subagents/demo-builder.ts`                   | Model-authored HTML and headless verification loop                                                       |
| `src/agent/subagents/headless.ts`                       | Node-side SVG rendering, HTML execution/probes and `HeadlessApi`                                         |
| `src/worker/headless-worker.ts`                         | Browser/worker equivalent, iframe-based demo verification and WASM SVG rasterization                     |
| `components/artifacts/steer-card.tsx`                   | Routes delivered `plot`/`visual` to SVG display, `demo` to HTML display                                  |
| `components/artifacts/visual-card.tsx`, `svg-image.tsx` | Original SVG displayed as an image document; download/fullscreen/inversion                               |
| `components/artifacts/demo-card.tsx`                    | Sandboxed `srcdoc`, resize/error bridge, source-window filtering, study-input tracking and HTML download |
| `src/agent/prompts/teacher/50-demos.md`                 | Teacher routing/authoring instructions; currently describes visual as static and still says “two” tools  |
| `scripts/plot-benchmark/`                               | Real teacher-to-job delivery evidence; currently assumes nonempty SVG for a delivered plot               |
| `scripts/plot-render-review.ts`                         | Offline rerender of saved inputs with provenance; currently embeds 1× PNG previews                       |
| `vite.config.ts`, `src/worker/shims/`                   | Desktop browser-worker bundling; Node imports need care                                                  |

Read `docs/plot-benchmark.md`, `docs/plot-semantic-annotations-plan.md`,
`docs/plot-formulas-sampling-plan.md` and `docs/plot-math-layout-plan.md` for the
implemented plot contracts and limits. Preserve `renderPlot` and all old inputs.
In particular, retain independent panel x-domains, log axes, safe expressions,
measured-point behavior and computed annotation coordinates.

DeepSeek compatibility matters: serialize numeric pairs as homogeneous arrays
with `minItems: 2, maxItems: 2`, using the existing TypeBox approach. Do not
reintroduce tuple schemas whose `items` is an array. Validate new union branches
through the real Pi tool validator, not just TypeScript.

### Existing evidence and known limits

- Latest live case 10: `data/plot-benchmark/2026-11-12T22-13-29-112Z-d8acb433`.
- Portable review: `data/plot-render-review/semantic-annotations-live/index.html`.
- Computed Gaussian crossing was approximately `x=0.12350000000001166`, with
  residual below the configured `1e-10` tolerance. Free-text captions can still
  repeat model-calculated values; renderer validation does not prove prose.
- Previous phase reported 194 related tests plus one real browser-worker test,
  formatter/linter/typecheck and Vite build passing. These are historical results,
  not fresh verification of this handoff or future changes.
- Review PNGs are 1× and can look soft on Retina. The app displays vector SVG.
  The user was told portable embedded SVG would improve review previews; that
  separate repair has not been implemented. New static review previews should
  use embedded SVG image documents rather than repeat the low-resolution issue.
- Saved job completion is distinct from delivery: require a persisted steer and
  projected artifact. Never equate a successful render with mathematical quality.

## 4. Milestone 0: close the design and portability questions

**Deliverable:** an updated, approved contract section and a small measured
renderer feasibility report. Do this before feature implementation. The proposals
in sections 5–7 give a concrete starting point, not an approved specification.

Resolve these decisions with the user, one question at a time. Present the
recommendation and tradeoff; avoid making the user select internal library names
without evidence.

1. Approve the initial supported set: 2D constructions/number lines, 3D surfaces
   and parametric curves, time-dependent plots and geometry. Decide whether 3D
   scatter/data points are needed immediately. Recommend deferring implicit
   surfaces, volumes, arbitrary meshes, chemistry layout and numerical physics
   solvers; those have not been included in the agreed detailed scope.
2. Approve schema evolution and result compatibility in sections 5–6, including
   the proposed internal tool names and visual output inspection protocol.
3. Approve playback defaults: paused initially versus autoplay, time domain versus
   playback duration, loop behavior, reduced-motion handling, fixed axis ranges,
   slider step, restart/camera-reset behavior and persistence of learner controls.
   Recommendation: start paused, no loop, explicit time range, stable axes and
   local transient controls; standard keyboard-accessible controls.
4. Choose the 3D backend after a feasibility comparison. Use official docs/source
   and verify current versions/licenses if selecting a dependency. Measure bundle
   size, offline self-contained packaging, surface gaps/occlusion, axis/math label
   quality, drag/zoom, frame export and WebGL failure behavior. Test headless Chrome
   and the browser-worker path. Identify WebView-specific risks; a Chrome-only
   pass does not prove native Tauri behavior. Native visual review is optional
   for the user, not a new desktop-automation requirement.
5. Approve resource limits, surface/curve sampling policy, rendering resolution,
   retry/failure policy and unsupported-device behavior. Set exact constants and
   expected error messages in the approved plan before implementation.

The feasibility report must explain how a maintained interactive runtime is
bundled into a portable HTML artifact **both from Node and from the browser
worker**. Node-only filesystem reads, CDN imports and Vite-only `?raw` imports
without a Node equivalent do not solve this contract. Also demonstrate capturing
frames with math labels from that runtime using both headless adapters.

No full live benchmark or API spending is required to choose a backend. Small
read-only investigations can proceed; ask before adding experimental dependencies
or implementation files when doing so would preempt an unapproved decision.

## 5. Proposed data and rendering contracts

### 5.1 Compatibility and numerical evaluation

Keep existing `PlotInput` and `renderPlot(input): Promise<string>` working. Add new
types in **`src/core/contracts/visualization.ts`**, exported through the core
barrels. Proposed teacher input:

```ts
type PlotToolInput =
  (PlotInput & { kind?: "2d"; time?: TimelineSpec }) | Plot3DInput;

interface TimelineSpec {
  domain: [number, number];
  durationSeconds: number;
}

interface Plot3DInput {
  kind: "3d";
  title: string;
  axes: {
    x: { label: string; domain: [number, number] };
    y: { label: string; domain: [number, number] };
    z: { label: string; domain: [number, number] };
  };
  layers: Array<
    | { kind: "surface"; id: string; label: string; expression: string }
    | {
        kind: "parametric-curve";
        id: string;
        label: string;
        uDomain: [number, number];
        x: string;
        y: string;
        z: string;
      }
  >;
  time?: TimelineSpec;
}
```

Proposal: surface expressions use `x,y` and optional `t`; parametric curves use
`u` and optional `t`; animated existing 2D expressions use `x,t`. Reserve `t` for
time. Start 3D axes as linear, with explicit finite ascending domains; preserve
existing 2D log scales. Require explicit y-domains for animated 2D panels to avoid
view-dependent rescaling. Static data is supplied as data, never invented samples.
Confirm data-layer shape if included in milestone 0.

Add **`src/agent/visualization/expression.ts`**:

```ts
type NumericVariable = "x" | "y" | "z" | "u" | "t";
function compileNumericExpression(
  source: string,
  allowedVariables: readonly NumericVariable[],
): (values: Readonly<Partial<Record<NumericVariable, number>>>) => number;
```

Share the existing bounded grammar/AST, functions and precedence. Preserve the
existing exported parser/compiler signatures as compatibility wrappers. Numeric
parsing must use an explicit allowed-variable set, reject unknown identifiers and
missing/nonfinite bindings, and never treat an unrecognized variable as `e`.
Retain the existing 2048-character and 256-token bounds. Keep display recognition
separate so adding numeric variables does not unexpectedly reformat prose.

Animation is a pure evaluation at supplied time, not accumulated integration.
Seeking to the same time returns the same numerical scene regardless of previous
playback, dropped frames or wall-clock timing. A deterministic evaluator does not
make a supplied physical equation correct or guarantee identical GPU pixels.

### 5.2 Structured 2D geometry

Proposed `GeometrySceneSpec` in the new contracts module:

- `title: string`; `points: GeometryPointSpec[]`; `objects: GeometryObjectSpec[]`;
  `annotations: GeometryAnnotationSpec[]`; optional `time: TimelineSpec`.
- `axes`: either `{kind:"cartesian"; xDomain:[number,number];
yDomain:[number,number]; xLabel:string; yLabel:string}` or
  `{kind:"number-line"; domain:[number,number]; label:string}`.
- A point is `{kind:"point"; id:string; x:number|string; y:number|string;
label?:string}` or `{kind:"midpoint"; id:string; a:string; b:string;
label?:string}`. String coordinates use constants and optional `t` only.
- Objects are `{kind:"segment"|"vector"; id:string; from:string; to:string;
label?:string}`, `{kind:"circle"; id:string; center:string;
radius:number|string; label?:string}`, or
  `{kind:"polygon"; id:string; vertices:string[]; label?:string}`.
- Annotations reference geometry: an angle names `a,vertex,b`; a length names a
  segment/vector ID; a point label names a point ID. Angle/length values are
  computed when requested, with descriptive captions separate from numeric values.
  A right-angle request validates perpendicularity before drawing the symbol.

Confirm exact annotation field names, marker visibility, circle labels and
geometric tolerances in milestone 0. Do not silently implement a broader generic
constraint solver. No arbitrary SVG paths, CSS or executable callbacks in these
specifications.

All IDs must be nonblank, unique within the scene and resolve to the correct
object type. Resolve derived points through an acyclic dependency graph; array
order is not dependency order. Detect unknown references and cycles. Reject
zero-length directions where a vector/angle requires direction, invalid radii,
degenerate requested angle constructions and nonfinite geometry with field paths.
Number-line points must lie on its one-dimensional axis. Preserve equal spatial
scale in geometric drawings; do not stretch angles or lengths to fill the frame.

Use the bundled MathJax label paths and measured layout. Adapt point/segment
obstacles, and add conservative circle/arc/polygon obstacles as needed; do not
pretend the existing segment-only layout already handles all shapes. Label overflow
must have an explicit readable fallback rather than shifting the referenced point.

### 5.3 Artifact result and public rendering seam

Proposed addition to the current legacy SVG result:

```ts
interface InteractiveVisualizationResult {
  format: "interactive";
  version: 1;
  title: string;
  html: string;
  preview: { mimeType: "image/png"; data: string }; // bounded base64 image
  verification: { runtime: "passed"; inspectedTimes: number[] };
  notes?: string;
}

type VisualizationResult = VisualResult | InteractiveVisualizationResult;

function renderPlotArtifact(input: PlotToolInput): Promise<VisualizationResult>;
function renderGeometryArtifact(
  input: GeometrySceneSpec,
): Promise<VisualizationResult>;
```

These functions return static SVG for static 2D input and interactive HTML for
3D/time input. Put preparation in **`src/agent/visualization/render.ts`**, with
injected verification dependencies rather than core importing agent/headless code.
Finalize the dependency argument/factory signature in milestone 0; the public
one-argument functions above describe the prepared rendering service, not a hidden
global browser dependency.

Retain the legacy empty-SVG failure representation during migration. Interactive
success requires nonempty HTML, valid preview and actual successful runtime
verification. Do not claim `inspectedTimes` unless images for those times reached
a subsequent visualization-agent model call; direct plot jobs should record an
empty list. Rendering/automated checks are distinct from model inspection.

Add a pure shared result validator in core for failure/delivery/UI branching.
Update `SubagentArtifactData`, `SteerDetails`, runner result signatures and failure
checks together. Old persisted `{svg,notes?,image?}` results require no migration.
Learner-image annotations continue through the current SVG/snapshot protocol.

HTML is generated by maintained renderer code with safely serialized input data,
bundled runtime dependencies and no required network requests. Validate and bound
inputs before serialization. Treat `</script>`, quotes, XML and formula text as
data. Keep generated markup outside the app DOM. Avoid duplicating large payloads
in model-facing steer text; full artifacts belong in persisted details.

## 6. Shared runtime, inspection and display

Create **`src/agent/visualization/runtime/`** with separate `timeline.ts`,
`geometry.ts`, `plot-3d.ts`, `controls.ts`, and `entry.ts`. Final backend adapters
and runtime-bundle build paths are chosen in milestone 0 and then listed exactly
in this document. Keep the 3D dependency out of the legacy static 2D path.

Proposed code-owned runtime inspection interface, unavailable to model input:

```ts
interface VisualizationRuntime {
  ready: Promise<void>;
  setTime(time: number): Promise<void>;
  getState(): { time: number | null; playing: boolean; renderRevision: number };
  captureFrame(): Promise<{ mimeType: "image/png"; data: string }>;
  dispose(): void;
}
```

Expose it at a fixed test hook, `window.__lhVisualization`, in generated HTML.
`ready` resolves only after geometry, glyph assets and the initial frame are
ready. `setTime` resolves after the requested frame is drawn. Frame export must
include labels/axes, not just a WebGL surface. Rendering failure must reject and
reach the existing artifact error path. Never mark an empty canvas as success.

Add an injected headless method in **`src/agent/subagents/headless.ts`** and
**`src/worker/headless-worker.ts`**:

```ts
inspectVisualization(
  html: string,
  times: readonly number[],
): Promise<{
  run: DemoRunResult;
  frames: Array<{ time: number | null; png: Buffer }>;
}>;
```

For a static interactive 3D view, `times=[]` captures one ready initial frame with
`time:null`; animated input captures requested times. Specify timeout, abort and
frame-byte limits at approval. Update every fake `HeadlessApi` implementation.
Both adapters use the same readiness/seek/export protocol. Node uses browser
automation; the worker uses its iframe bridge, with source/request-ID checks and
cleanup. This needs a portability test, not just a fake protocol test.

Create **`components/artifacts/interactive-visualization-card.tsx`** for the new
result branch. Extract a shared sandbox frame from `demo-card.tsx` into
**`components/artifacts/sandbox-frame.tsx`** if needed; keep existing demo appearance
and behavior. Reuse resize/error/study-input plumbing and source-window checks,
but label the new output as a figure/plot rather than “interactive demo.” Preserve
`sandbox="allow-scripts"` without same-origin privileges, HTML download and old
SVG display. Handle loading, runtime failure, resize, unmount and multiple figures.
Decide inversion/fullscreen behavior in the milestone-0 UX approval.

In **`src/agent/subagents/visual-maker.ts`**, proposed tools are:

| Internal tool          | Input and behavior                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `draw_geometry`        | `{scene:GeometrySceneSpec}` replaces current output with validated structured geometry                                 |
| `draw_plot`            | `{plot:PlotToolInput}` uses the same renderer as direct plot; no nested model/job                                      |
| `inspect_visual`       | Inspects the current artifact; code chooses initial/mid/end times for animation and supplies images after tool results |
| Existing raw SVG tools | Retained for unsupported figures and learner-image annotation                                                          |

Introduce **`src/agent/subagents/visual-state.ts`** for a revision-based state
machine shared by output formats. An output revision is eligible for delivery
only when its required render/frames were supplied to a later model call.
Changing structured input invalidates inspection. A failed draw must not silently
deliver a previous successful artifact as the attempted replacement. Raw
`edit_svg` must not bypass structured invariants: require replacement through its
structured tool, or an explicit transition to raw-SVG mode whose verification
claims no longer describe structured geometry. Confirm transition behavior before
implementation. Learner-image mode retains its existing static protocol.

## 7. Implementation milestones and concrete checks

Each milestone must leave a working, reviewable result. After milestone 0 approval,
fill in its chosen constants, backend and any revised signatures before coding.

### 1 — Static structured geometry inside the visualization agent

**Create:** `src/core/contracts/visualization.ts`,
`src/agent/visualization/schema.ts`, `expression.ts`, `geometry.ts`, `labels.ts`,
`layout.ts`, `render.ts`, `src/agent/subagents/visual-state.ts`,
`tests/visualization-expression.test.ts`, `tests/visualization-geometry.test.ts`,
`tests/visualization-schema.test.ts`, `tests/visualization-agent.test.ts`,
`tests/fixtures/visualization/geometry.json`.

**Modify:** core export barrels, `src/agent/plot-expression.ts`,
`src/agent/subagents/visual-maker.ts`, `src/agent/prompts/teacher/50-demos.md`,
and the `visual` description in `src/agent/tools/jobs.ts`.

`labels.ts`/`layout.ts` adapt existing plot helpers rather than rewriting MathJax
or refactoring every plot file. `geometry.ts` exports
`resolveGeometryScene(spec, time): ResolvedGeometryScene`; finalize the resolved
point/shape/bounds structure in milestone 0 and test numerical coordinates
independently of SVG text. Keep static `renderGeometryArtifact` on the SVG path.

**Acceptance:** a 3-4-5 triangle shows a computed length 5 and a correctly placed
right-angle marker; a nonperpendicular angle rejects that marker; midpoint and
vector references survive point reordering; a number line preserves positions.
Test cycles, wrong-type IDs, duplicate IDs, invalid radii, degenerate angles,
text/geometry collisions, math glyphs, overflow, input immutability, and malicious
label text. Scripted model tests prove inspect-before-delivery, invalidation after
edits, recovery after bad input, and unchanged learner-image/raw-SVG paths.

**Run:** new milestone tests plus `tests/demos.test.tsx`,
`tests/plot.test.ts`, `tests/plot-labels.test.ts`, `tests/plot-layout.test.ts`,
`tests/plot-math-format.test.ts`, `tests/plot-tool-schema.test.ts`.

### 2 — Portable interactive artifact infrastructure and static 3D plots

**Create:** runtime files from section 6 and the approved bundling files,
`components/artifacts/interactive-visualization-card.tsx`,
`components/artifacts/sandbox-frame.tsx` if extracting the shared frame,
`tests/visualization-runtime.test.ts`, `tests/visualization-browser.test.ts`,
`tests/visualization-delivery.test.ts`,
`tests/fixtures/visualization/plots-3d.json`.

**Modify:** `src/core/contracts/jobs.ts`, new visualization contracts/schema,
`src/agent/tools/jobs.ts`, `src/agent/tools.ts`, `src/agent/subagents/runner.ts`,
both headless adapters, `components/artifacts/steer-card.tsx`,
`components/artifacts/demo-card.tsx`, `src/agent/subagents/visual-maker.ts`,
`vite.config.ts`/`package.json`/lockfile only as required by the approved backend.

**Acceptance:** paraboloid `z=x^2+y^2`, saddle `z=x*y`, helix
`x=cos(u), y=sin(u), z=u`, correct axis orientations and numeric reference points.
Rotation/zoom change camera state without altering numerical data. Gaps do not
become triangles across invalid samples; domain splitting and bounded sampling
limits are documented. Test readiness, frame export with math labels, offline
HTML opened by itself, HTML injection strings, errors, multiple iframes, cleanup,
pixel density, and graceful unsupported-device behavior according to approval.
Ensure ordinary 2D plots still bypass model selection and avoid loading 3D code.

Update **`scripts/plot-benchmark/case-runner.ts`**, `contracts.ts`, `report.ts` and
**`scripts/plot-render-review.ts`** for the new artifact branch. Update their tests
in the same milestone. A preview alone is not a successful interactive delivery;
require the valid interactive payload and runtime evidence plus persisted/projected
delivery. Retain old report formats and immutable input/result provenance. Do not
rewrite saved baseline runs.

**Run:** new milestone tests plus `tests/jobs.test.ts`, `tests/pending-authority.test.ts`,
`tests/job-delivery-recovery.test.ts`,
`tests/demos.test.tsx`, `tests/worker-headless.test.ts`,
`tests/plot-benchmark.test.ts`, `tests/plot-benchmark-flow.test.ts`,
`tests/plot-render-review.test.ts`, `tests/plot-tool-schema.test.ts` and
`tests/plot-worker.test.ts`. Record native WebView behavior as unverified unless
the user separately checks it; do not substitute Chrome evidence for that claim.

### 3 — Time-driven plots and geometry

**Create:** `tests/visualization-timeline.test.ts`,
`tests/fixtures/visualization/animations.json`.

**Modify:** expression/schema/render/geometry/runtime files, visualization-agent
inspection state, teacher tool descriptions and headless tests from prior stages.
Do not add a separate teacher animation tool.

**Acceptance:** traveling wave `sin(x-t)`, animated surface `sin(x+t)*cos(y)`,
moving point `(cos(t),sin(t))` with a referenced vector, and a changing midpoint.
Seek start/middle/end in different orders and compare independent numerical
expectations. Test pause, resume, restart, loop policy, keyboard scrubbing,
background-tab timing, resize, reduced motion, fixed axes and teardown. A time
where geometry is undefined must follow the approved error/gap policy and cannot
silently reuse stale geometry. Verify required inspection frames reach a later
model call and are invalidated when the specification changes.

**Run:** new timeline tests, visualization agent/browser/runtime/delivery suites,
and existing plot sampling/annotation tests. Set meaningful numerical/sampling
and responsive-control acceptance budgets in milestone 0; do not claim animation
correctness from “no console errors” or a screenshot at time zero.

### 4 — Demo reuse, teacher guidance and review artifacts

**Modify:** `src/agent/subagents/demo-builder.ts` to expose approved shared renderer
wrappers; `tests/demos.test.tsx`; `src/agent/tools/jobs.ts` and
`src/agent/prompts/teacher/50-demos.md` with approved routing examples.

Proposed demo-builder wrapper: `write_visualization({spec})` prepares a complete
maintained visualization document as its current demo, followed by the existing
`run_demo` gate. The accepted `spec` is `PlotToolInput | GeometrySceneSpec` behind
an explicit discriminator. Static SVG can be wrapped as a document. Do not promise
composition with arbitrary custom HTML until its embedding contract is designed;
do not ask the model to paste the renderer's bundle. Confirm whether this initial
whole-document reuse meets the user's intended demo reuse before implementing it.

**Create:** `docs/deterministic-visualization.md`,
`scripts/visualization-review.ts`, `tests/visualization-review.test.ts`.

Review CLI contract:
`node --import tsx scripts/visualization-review.ts --out <new-directory>`.
It consumes the checked-in fixtures, refuses existing output directories, makes no
model calls, and writes `index.html`, `results.json`, portable HTML artifacts and
original SVGs. Embed static vector previews as SVG image documents; include
clearly labeled time snapshots and interactive HTML links for dynamic outputs.
Record fixture hashes, renderer/backend versions, numerical checks and failures.
Keep automatic evidence distinct from the user's manual visual/math assessment.

Teacher examples must distinguish standard rotation/playback from a custom demo,
prefer analytic equations over fabricated samples, explain supported expression
variables, and route unsupported simulations to `demo`. Replace the stale “two
tools” and “precise static figures” wording. Remove raw function-plot authoring
from the visualization agent's preferred workflow. Prompt wording needs approval.

**Run:** review and demo tests, all visualization tests, the existing plot
regressions below, a representative offline browser run, and desktop Vite build.
Live model evaluation is optional only after user authorization; preserve the
switchable model configuration and record each actual model used.

## 8. Verification commands and completion evidence

Before changes, record the current working tree and run a scoped baseline so
pre-existing failures can be distinguished. Existing regression command:

```sh
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-annotations.test.ts tests/plot.test.ts tests/plot-tool-schema.test.ts tests/plot-labels.test.ts tests/plot-math-format.test.ts tests/plot-sampling.test.ts tests/plot-layout.test.ts tests/plot-render-review.test.ts tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending-authority.test.ts tests/job-delivery-recovery.test.ts
NODE_ENV=test node --import tsx --test tests/plot-worker.test.ts tests/worker-headless.test.ts
```

Once the new files exist, execute each milestone's concrete test file list; after
all milestones the new-test command is:

```sh
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/visualization-expression.test.ts tests/visualization-geometry.test.ts tests/visualization-schema.test.ts tests/visualization-agent.test.ts tests/visualization-runtime.test.ts tests/visualization-browser.test.ts tests/visualization-delivery.test.ts tests/visualization-timeline.test.ts tests/visualization-review.test.ts
node --import tsx scripts/visualization-review.ts --out data/visualization-review/initial
npm run typecheck
npm run vite:build
git diff --check
```

Use a fresh review output path if `initial` already exists. Browser tests may need
sandbox permission to launch system Chrome/listen locally; use the established
headless test setup. Do not require full desktop automation for every iteration.

Format/lint all touched code, including ignored `scripts/` files explicitly:

```sh
npm exec -- prettier --write <explicit modified TS/TSX/JSON/MD paths>
npm exec -- prettier --check <same paths>
npm exec -- eslint --no-ignore --fix <explicit modified TS/TSX paths>
npm exec -- eslint --no-ignore <same code paths>
npm run typecheck
```

Replace placeholders with the milestone's exact touched paths before executing;
preserve each existing file's formatting convention and avoid unrelated diffs.
These are implementation checks, not requirements to lint prose with ESLint.

Completion requires saved evidence of numerical correctness tests, schema/Pi
validation, delivery compatibility, offline artifact loading, all playback/camera
controls, browser-worker operation, cleanup, build/lint/typecheck, and any actual
native WebView verification. Report bundle sizes/performance and limits honestly.
No model inspection or renderer validates arbitrary explanatory prose or proves a
physical model correct. No current implementation or verification of this feature
is implied by this handoff.
