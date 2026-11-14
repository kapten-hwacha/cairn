import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Resvg } from "@resvg/resvg-js";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { jobTools } from "../src/agent/tools/jobs.ts";
import { jobStore } from "../src/store/jobs.ts";
import { renderPlot } from "../src/agent/plot.ts";
import { plotXml } from "../src/agent/plot-labels.ts";
import type { JobRecord, PlotInput } from "../src/core/contracts.ts";
import { caseSetSchema } from "./plot-benchmark/contracts.ts";

const inputHash = (input: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(input) ?? "null")
    .digest("hex");
interface ReviewPlot {
  id: string;
  input: unknown;
  originalInput: unknown;
  beforeSvg: string | null;
  reason: string | null;
}
interface ReviewResult {
  id: string;
  input: unknown;
  error: string | null;
  sourceHash: string;
  before: string | null;
  after: string | null;
  inputProvenance: {
    kind: "original" | "variant";
    originalInputHash: string;
    reason: string | null;
  };
}
const variantsSchema = z
  .object({
    schemaVersion: z.literal(1),
    variants: z.array(
      z
        .object({
          caseId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
          attempt: z.number().int().positive(),
          plotIndex: z.number().int().positive(),
          input: z.unknown(),
          reason: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export async function renderReview(
  run: string,
  output: string,
  variantsFile?: string,
) {
  const runDir = path.resolve(run),
    out = path.resolve(output);
  const relative = path.relative(runDir, out);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new Error("Output must be outside the source run");
  const set = caseSetSchema.parse(
    JSON.parse(fs.readFileSync(path.join(runDir, "cases.json"), "utf8")),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"),
  );
  if (!Number.isSafeInteger(manifest.repetitions) || manifest.repetitions < 1)
    throw new Error("Invalid repetitions in source run");
  const tool = jobTools({
    chatId: "render-review",
    jobStore,
    spawn: () => {
      throw new Error("Render review never dispatches jobs");
    },
  }).plot!;
  const validate = (id: string, input: unknown): PlotInput =>
    validateToolArguments(tool, {
      type: "toolCall",
      id,
      name: "plot",
      arguments: input as Parameters<
        typeof validateToolArguments
      >[1]["arguments"],
    }) as PlotInput;
  const tasks: ReviewPlot[] = [];
  for (const c of set.cases)
    for (let attempt = 1; attempt <= manifest.repetitions; attempt++) {
      const jobs = JSON.parse(
        fs.readFileSync(
          path.join(runDir, c.id, `attempt-${attempt}`, "jobs.json"),
          "utf8",
        ),
      ) as JobRecord[];
      for (const [i, job] of jobs.filter((j) => j.kind === "plot").entries()) {
        const original = job.result as { svg?: unknown } | undefined;
        tasks.push({
          id: `${c.id}-attempt-${attempt}-plot-${i + 1}`,
          input: job.input,
          originalInput: job.input,
          beforeSvg: typeof original?.svg === "string" ? original.svg : null,
          reason: null,
        });
      }
    }
  if (variantsFile) {
    const variants = variantsSchema.parse(
      JSON.parse(fs.readFileSync(variantsFile, "utf8")),
    );
    const seen = new Set<string>();
    const originals = new Map(tasks.map((t) => [t.id, t]));
    for (const variant of variants.variants) {
      const target = `${variant.caseId}-attempt-${variant.attempt}-plot-${variant.plotIndex}`;
      if (seen.has(target))
        throw new Error(`Duplicate variant target: ${target}`);
      seen.add(target);
      const original = originals.get(target);
      if (!original) throw new Error(`Missing variant target: ${target}`);
      validate(target, variant.input);
      tasks.push({
        ...original,
        id: `${target}-variant`,
        input: variant.input,
        reason: variant.reason,
      });
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out, { mode: 0o700 });
  fs.writeFileSync(path.join(out, ".gitignore"), "*\n");
  const results: ReviewResult[] = [];
  const previews = new Map<string, string>();
  for (const task of tasks) {
    const result: ReviewResult = {
      id: task.id,
      input: task.input,
      error: null,
      sourceHash: inputHash(task.input),
      before: null,
      after: null,
      inputProvenance: {
        kind: task.reason === null ? "original" : "variant",
        originalInputHash: inputHash(task.originalInput),
        reason: task.reason,
      },
    };
    if (task.beforeSvg) {
      result.before = `${task.id}-before.svg`;
      fs.writeFileSync(path.join(out, result.before), task.beforeSvg);
      try {
        previews.set(
          result.before,
          new Resvg(task.beforeSvg).render().asPng().toString("base64"),
        );
      } catch {
        // Keep malformed historical evidence without blocking valid new renders.
      }
    }
    try {
      const svg = await renderPlot(validate(task.id, task.input));
      const png = new Resvg(svg).render().asPng();
      result.after = `${task.id}-after.svg`;
      previews.set(result.after, png.toString("base64"));
      fs.writeFileSync(path.join(out, result.after), svg);
      fs.writeFileSync(path.join(out, `${task.id}-after.png`), png);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    results.push(result);
  }
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        sourceRun: runDir,
        renderer: "MathJax 4.1.3 / TeX font 4.1.3",
        results,
      },
      null,
      2,
    ),
  );
  const indexFile = path.join(out, "index.html");
  fs.writeFileSync(
    indexFile,
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plot rendering comparison</title><style>body{font:16px/1.5 system-ui;max-width:1600px;margin:32px auto;padding:0 24px;color:#17242c;background:#fafafa;overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{max-width:100%;height:auto;background:white}figure{margin:0;min-width:0}article{border-top:1px solid #ccd4da;margin-top:32px;padding-top:16px}.error{color:#9c1c1c}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:850px){.pair{grid-template-columns:1fr}}</style><h1>Plot rendering comparison</h1><p>Saved inputs from ${plotXml(runDir)}. No model calls; original run unchanged. Sampling refinement can change curve geometry. Mathematical correctness requires review.</p><p>${results.length} plots · ${results.filter((r) => r.error).length} render failures · <a href="results.json">Inputs and render results</a></p>${results.map((r) => `<article><h2>${plotXml(r.id)}</h2><p>${r.inputProvenance.kind === "variant" ? `Revised input: ${plotXml(r.inputProvenance.reason!)}` : "Same saved input; updated renderer."}</p><div class="pair"><figure><figcaption>Before — original saved SVG</figcaption>${r.before ? `${previews.has(r.before) ? `<img src="data:image/png;base64,${previews.get(r.before)}" alt="Original ${plotXml(r.id)}">` : `<a href="${r.before}">Original SVG (preview unavailable)</a>`}` : "No original SVG"}</figure><figure><figcaption>After${r.inputProvenance.kind === "variant" ? " — revised input" : ""}</figcaption>${r.after ? `<a href="${r.after}"><img src="data:image/png;base64,${previews.get(r.after)}" alt="Updated ${plotXml(r.id)}"></a> · <a href="${r.id}-after.png">PNG</a>` : `<pre class="error">${plotXml(r.error ?? "Render unavailable")}</pre>`}</figure></div></article>`).join("")}</html>`,
  );
  return {
    rendered: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    indexFile,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const flags = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--run", "--out", "--variants"].includes(args[i]!) ||
        !args[i + 1] ||
        flags.has(args[i]!)
      )
        throw new Error(
          "Usage: node --import tsx scripts/plot-render-review.ts --run <existing-run-dir> --out <new-directory> [--variants <file>]",
        );
      flags.set(args[i]!, args[i + 1]!);
    }
    if (!flags.has("--run") || !flags.has("--out"))
      throw new Error("--run and --out are required");
    const result = await renderReview(
      flags.get("--run")!,
      flags.get("--out")!,
      flags.get("--variants"),
    );
    console.log(JSON.stringify(result));
    process.exitCode = result.failed ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
