import fs from "node:fs";
import path from "node:path";
import {
  reviewSchema,
  pendingReview,
  expectedCandidate,
  classifyFailureStage,
  type CaseResult,
  type RunManifest,
} from "./contracts.ts";
import { readJson, writeJson } from "./io.ts";

export const escapeHtml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const e = escapeHtml;
const attemptKey = (r: CaseResult) => `${r.caseId}/attempt-${r.attempt}`;
const safeFile = (file: string) =>
  !path.isAbsolute(file) &&
  !file.split(/[\\/]/).includes("..") &&
  !/[\x00-\x1f:]/.test(file);
export async function writeReport(
  runDir: string,
  manifest: RunManifest,
  results: CaseResult[],
): Promise<void> {
  const reviewFile = path.join(runDir, "review.json");
  const raw = fs.existsSync(reviewFile) ? readJson(reviewFile) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("review.json must be an object keyed by case/attempt");
  const reviews = raw as Record<string, unknown>;
  const merged = results.map((r) => {
    const key = attemptKey(r);
    const review =
      reviews[key] === undefined
        ? pendingReview()
        : reviewSchema.parse(reviews[key]);
    reviews[key] = review;
    return { ...r, failureStage: classifyFailureStage(r), review };
  });
  writeJson(reviewFile, reviews);
  writeJson(path.join(runDir, "results.json"), merged);
  const counts: Record<string, number> = {};
  const failureStages: Record<string, number> = {};
  merged.forEach((r) => {
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    if (r.failureStage)
      failureStages[r.failureStage] = (failureStages[r.failureStage] ?? 0) + 1;
  });
  writeJson(path.join(runDir, "analysis.json"), {
    schemaVersion: 1,
    classificationVersion: "1",
    generatedAt: new Date().toISOString(),
    failureStages,
    note: "Known tool-schema rejections are classified as invocation failures. Raw attempt results remain unchanged.",
  });
  const completeCost =
    merged.length > 0 &&
    merged.every((r) => r.cost.complete && r.cost.usd !== null);
  const cost = completeCost
    ? `$${merged.reduce((sum, r) => sum + r.cost.usd!, 0).toFixed(6)} (see per-case provenance)`
    : "Unknown/incomplete; see per-case usage";
  const candidateCount = merged.filter((r) => {
    const c = manifest.cases.find((c) => c.id === r.caseId);
    return c && expectedCandidate(c, r);
  }).length;
  const articles = merged
    .map((r) => {
      const c = manifest.cases.find((c) => c.id === r.caseId);
      if (!c) throw new Error(`Result has unknown case: ${r.caseId}`);
      if (
        !/^[a-z0-9][a-z0-9-]*$/.test(r.caseId) ||
        !Number.isSafeInteger(r.attempt) ||
        r.attempt < 1
      )
        throw new Error("Invalid attempt identity");
      const prefix = attemptKey(r);
      const files = r.evidence.files
        .filter(safeFile)
        .map((file) => `<a href="${e(`${prefix}/${file}`)}">${e(file)}</a>`)
        .join(" · ");
      const images = r.evidence.artifacts
        .filter((a) => safeFile(a.file))
        .map(
          (a) =>
            `<figure><img src="${e(`${prefix}/${a.file}`)}" alt="${e(c.id)} plot from ${e(a.jobId)}"><figcaption>${e(a.jobId)} (${e(a.kind)}): ${a.delivered ? "delivered" : "saved, delivery unconfirmed"}</figcaption></figure>`,
        )
        .join("");
      let view: unknown = [];
      const viewFile = path.join(runDir, prefix, "view.json");
      if (fs.existsSync(viewFile)) view = readJson(viewFile);
      const transcript = Array.isArray(view)
        ? view
            .map(
              (m: {
                role?: string;
                parts?: { type?: string; text?: string }[];
              }) =>
                `${m.role ?? "unknown"}:\n${(m.parts ?? [])
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join("\n")}`,
            )
            .join("\n\n")
        : "Transcript unavailable";
      return `<article id="${e(`${r.caseId}-${r.attempt}`)}"><h2>${e(c.id)} · attempt ${r.attempt}</h2>
      <p class="status">${e(r.outcome)}${r.failureStage ? ` · ${e(r.failureStage)}` : ""}</p>
      <p>${e(c.prompt)}</p><p>${e(r.reason ?? "")}</p>
      <h3>Expected result (${e(c.partition)})</h3><ul>${c.review.requirements.map((s) => `<li>${e(s)}</li>`).join("")}</ul>
      ${c.review.landmarks.length ? `<table><tr><th>Landmark</th><th>x</th><th>y</th><th>Absolute tolerance</th></tr>${c.review.landmarks.map((l) => `<tr><td>${e(l.description)}</td><td>${e(l.x)}</td><td>${e(l.y)}</td><td>${e(l.tolerance)}</td></tr>`).join("")}</table>` : ""}
      <p>Misleading failures: ${e(c.review.misleadingFailures.join(" "))}</p>${images || "<p>No SVG produced.</p>"}
      <h3>Your review</h3><p>Correctness: ${e(r.review.correctness)} · Readability: ${e(r.review.readability)} · Misleading: ${e(r.review.misleading)}</p><pre>${e(r.review.notes)}</pre>
      <details><summary>Transcript</summary><pre>${e(transcript)}</pre></details>
      <details><summary>Timings, delivery and usage</summary><pre>${e(JSON.stringify({ timingsMs: r.timingsMs, evidence: r.evidence, usage: r.usage, cost: r.cost }, null, 2))}</pre></details><p>${files}</p></article>`;
    })
    .join("\n");
  const latencyRows = manifest.cases
    .map((c) => {
      const values = merged
        .filter((r) => r.caseId === c.id)
        .map((r) => r.timingsMs.total)
        .sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const median =
        values.length % 2
          ? values[middle]
          : values.length
            ? (values[middle - 1]! + values[middle]!) / 2
            : null;
      return `<tr><td>${e(c.id)}</td><td>${values.length}</td><td>${e(values[0] ?? "unknown")}</td><td>${e(median ?? "unknown")}</td><td>${e(values.at(-1) ?? "unknown")}</td></tr>`;
    })
    .join("");
  fs.writeFileSync(
    path.join(runDir, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plot benchmark</title>
    <style>body{font:17px/1.55 system-ui,sans-serif;max-width:1080px;margin:40px auto;padding:0 24px;color:#17242c;background:#fafafa}article{border-top:2px solid #ccd4da;margin:48px 0;padding-top:24px}img{max-width:100%;height:auto;background:white}figure{margin:24px 0;overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf0f2;padding:16px}table{border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px;border:1px solid #cdd3d8}.status{font-weight:700}a{color:#005d91}h1,h2{line-height:1.2}details{margin:16px 0}</style>
    <h1>Plot benchmark</h1><p>${e(manifest.model.provider)}:${e(manifest.model.id)} · thinking ${e(manifest.model.resolvedThinking ?? "default")} · ${e(manifest.startedAt)}</p>
    <p>${merged.length} attempts; ${candidateCount} expected observable candidates. These are delivery/response outcomes, not mathematical or visual passes. Human review is separate.</p>
    <p>${e(JSON.stringify(counts))}</p><p>Failure stages: ${e(JSON.stringify(failureStages))}. Request failures remain in the infrastructure-failed outcome bucket; the stage identifies known invocation defects.</p><p>Total cost: ${e(cost)}</p>
    <p>Review SVGs and transcript against the expectations. Edit <a href="review.json">review.json</a>, then rerun with <code>--report-only</code> to update this report without inference.</p>
    <p><a href="manifest.json">Run provenance</a> · <a href="settings.json">Public settings snapshot</a> · <a href="results.json">Structured results</a></p>
    <p>Single trials do not estimate model variability. Narrow peaks and discontinuities require particular care. This Node harness does not test desktop UI or SQLite crash recovery.</p>
    <table><tr><th>Case</th><th>Attempts</th><th>Min ms</th><th>Median ms</th><th>Max ms</th></tr>${latencyRows}</table>${articles}</html>`,
    { mode: 0o600 },
  );
}
