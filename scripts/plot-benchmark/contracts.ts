import { z } from "zod";
import type { UserSettings } from "../../src/core/settings.ts";
import type { ThinkingLevel } from "../../config.ts";

export const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  partition: z.enum(["development", "held-out"]),
  prompt: z.string().trim().min(1),
  expectedOutcome: z.enum(["plot", "clarification-or-limitation"]),
  review: z.object({
    requirements: z.array(z.string().min(1)).min(1),
    landmarks: z.array(
      z.object({
        description: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
        tolerance: z.number().finite().nonnegative(),
      }),
    ),
    misleadingFailures: z.array(z.string().min(1)),
  }),
});
export const caseSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    caseSetVersion: z.string().min(1),
    cases: z.array(caseSchema).min(1),
  })
  .superRefine((set, ctx) => {
    if (new Set(set.cases.map((c) => c.id)).size !== set.cases.length)
      ctx.addIssue({ code: "custom", message: "Duplicate case IDs" });
  });
export type BenchmarkCase = z.infer<typeof caseSchema>;
export type CaseSet = z.infer<typeof caseSetSchema>;
export const reviewSchema = z.object({
  correctness: z.enum(["pending", "pass", "fail"]),
  readability: z.enum(["pending", "pass", "fail"]),
  misleading: z.enum(["pending", "yes", "no"]),
  notes: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;
export const pendingReview = (): Review => ({
  correctness: "pending",
  readability: "pending",
  misleading: "pending",
  notes: "",
});
export type Outcome =
  | "artifact-delivered"
  | "response-only"
  | "awaiting-input"
  | "job-failed"
  | "timed-out"
  | "infrastructure-failed";
export interface Artifact {
  jobId: string;
  kind: string;
  file: string;
  delivered: boolean;
}
export interface CaseResult {
  schemaVersion: 1;
  caseId: string;
  attempt: number;
  outcome: Outcome;
  failureStage:
    | "interpretation"
    | "invocation"
    | "execution"
    | "rendering"
    | "delivery"
    | "infrastructure"
    | null;
  reason: string | null;
  evidence: {
    files: string[];
    artifacts: Artifact[];
    plotInvoked: boolean;
    jobCompleted: boolean;
    savedMarker: boolean;
    projectedArtifact: boolean;
    postDeliveryTeacherText: boolean;
    requestCount: number;
  };
  timingsMs: {
    firstResponse: number | null;
    dispatch: number | null;
    computation: number | null;
    delivery: number | null;
    total: number;
  };
  usage: Array<{
    messageId: string;
    model: string;
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    reasoning: number | null;
    raw: unknown;
  }>;
  cost: {
    usd: number | null;
    source: "provider" | "catalog-estimate" | "mixed" | null;
    complete: boolean;
  };
  review: Review;
}
export interface ProfileSnapshot {
  settings: UserSettings;
  promptOverrides: Record<string, string>;
  authContent: string | null;
}
export interface CaseRunOptions {
  case: BenchmarkCase;
  attempt: number;
  settings: UserSettings;
  promptOverrides: Record<string, string>;
  profileDir: string;
  outputDir: string;
  timeoutMs: number;
}
export interface RunManifest {
  schemaVersion: 1;
  caseSetVersion: string;
  caseSetHash: string;
  startedAt: string;
  endedAt: string | null;
  profileDir: string;
  repetitions: number;
  timeoutMs: number;
  model: {
    provider: string;
    id: string;
    requestedThinking: string | null;
    resolvedThinking: string | null;
  };
  settingsHash: string;
  profileSettingsHash: string;
  promptOverridesHash: string;
  revision: string;
  dirtyStatus: string;
  trackedDiffHash: string;
  untrackedHashes: Record<string, string>;
  runtime: { node: string; platform: string; arch: string };
  dependencies: Record<string, string>;
  cases: BenchmarkCase[];
}
export interface CliOptions {
  profileDir?: string;
  cases: string;
  ids: string[];
  repetitions: number;
  timeoutMs: number;
  out?: string;
  reportOnly?: string;
  model?: { provider: string; id: string };
  thinking?: ThinkingLevel;
}
const levels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export function parseArgs(args: string[]): CliOptions {
  const out: CliOptions = {
    cases: "tests/fixtures/plot-benchmark/cases.json",
    ids: [],
    repetitions: 1,
    timeoutMs: 120_000,
  };
  const names = new Set([
    "--profile-dir",
    "--cases",
    "--case",
    "--repetitions",
    "--timeout-ms",
    "--out",
    "--report-only",
    "--model",
    "--thinking",
  ]);
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!names.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (flag !== "--case" && seen.has(flag))
      throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--profile-dir":
        out.profileDir = value;
        break;
      case "--cases":
        out.cases = value;
        break;
      case "--case":
        out.ids.push(value);
        break;
      case "--out":
        out.out = value;
        break;
      case "--report-only":
        out.reportOnly = value;
        break;
      case "--model": {
        const split = value.indexOf(":");
        if (split < 1 || split === value.length - 1 || /\s/.test(value))
          throw new Error("--model requires provider:model-id");
        out.model = {
          provider: value.slice(0, split),
          id: value.slice(split + 1),
        };
        break;
      }
      case "--thinking":
        if (!levels.includes(value as ThinkingLevel))
          throw new Error(`Invalid thinking level: ${value}`);
        out.thinking = value as ThinkingLevel;
        break;
      default: {
        const n = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n <= 0)
          throw new Error(`${flag} requires a positive integer`);
        if (flag === "--repetitions") out.repetitions = n;
        else out.timeoutMs = n;
      }
    }
  }
  if (out.reportOnly) {
    if (seen.size !== 1)
      throw new Error("--report-only cannot be combined with live options");
  } else if (!out.profileDir)
    throw new Error("--profile-dir is required for a live run");
  return out;
}
export function selectCases(set: CaseSet, ids: string[]): BenchmarkCase[] {
  for (const id of ids)
    if (!set.cases.some((c) => c.id === id))
      throw new Error(`Unknown case: ${id}`);
  return set.cases.filter((c) => !ids.length || ids.includes(c.id));
}
export function applyModelOptions(
  settings: UserSettings,
  options: Pick<CliOptions, "model" | "thinking">,
): UserSettings {
  const copy = structuredClone(settings);
  copy.models = {
    ...copy.models,
    strong: {
      ...copy.models?.strong,
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
    },
  };
  if (!copy.models.strong?.model)
    throw new Error(
      "No conversation model configured; use --model provider:model-id",
    );
  return copy;
}
export function initialResult(caseId: string, attempt: number): CaseResult {
  return {
    schemaVersion: 1,
    caseId,
    attempt,
    outcome: "infrastructure-failed",
    failureStage: "infrastructure",
    reason: "Attempt has not completed",
    evidence: {
      files: [],
      artifacts: [],
      plotInvoked: false,
      jobCompleted: false,
      savedMarker: false,
      projectedArtifact: false,
      postDeliveryTeacherText: false,
      requestCount: 0,
    },
    timingsMs: {
      firstResponse: null,
      dispatch: null,
      computation: null,
      delivery: null,
      total: 0,
    },
    usage: [],
    cost: { usd: null, source: null, complete: false },
    review: pendingReview(),
  };
}
export function expectedCandidate(
  c: BenchmarkCase,
  result: CaseResult,
): boolean {
  return c.expectedOutcome === "plot"
    ? result.outcome === "artifact-delivered"
    : result.outcome === "awaiting-input" || result.outcome === "response-only";
}

/** A provider refusing a declared tool schema is an invocation defect, not
 * evidence that the benchmark's storage/rendering infrastructure failed. */
export function classifyFailureStage(
  result: CaseResult,
): CaseResult["failureStage"] {
  return /invalid schema for function|invalid_function_parameters/i.test(
    result.reason ?? "",
  )
    ? "invocation"
    : result.failureStage;
}
