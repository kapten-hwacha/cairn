import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  caseSetSchema,
  parseArgs,
  selectCases,
  applyModelOptions,
  expectedCandidate,
  type CaseResult,
  type CaseRunOptions,
  type RunManifest,
} from "./plot-benchmark/contracts.ts";
import { loadProfile } from "./plot-benchmark/profile.ts";
import { hash, readJson, writeJson } from "./plot-benchmark/io.ts";
import { writeReport } from "./plot-benchmark/report.ts";
import { superviseCase } from "./plot-benchmark/process.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function main(args: string[]): Promise<number> {
  const cli = parseArgs(args);
  if (cli.reportOnly) {
    const dir = path.resolve(cli.reportOnly);
    const manifest = readJson(path.join(dir, "manifest.json")) as RunManifest;
    if (manifest.schemaVersion !== 1)
      throw new Error("Unsupported manifest schema");
    manifest.cases = caseSetSchema.parse({
      schemaVersion: 1,
      caseSetVersion: manifest.caseSetVersion,
      cases: manifest.cases,
    }).cases;
    const results: CaseResult[] = [];
    for (const c of manifest.cases)
      for (let attempt = 1; attempt <= manifest.repetitions; attempt++) {
        results.push(
          readJson(
            path.join(dir, c.id, `attempt-${attempt}`, "result.json"),
          ) as CaseResult,
        );
      }
    await writeReport(dir, manifest, results);
    console.log(path.join(dir, "index.html"));
    return 0;
  }
  const caseFile = path.resolve(root, cli.cases);
  const set = caseSetSchema.parse(readJson(caseFile));
  const cases = selectCases(set, cli.ids);
  const profileDir = path.resolve(cli.profileDir!);
  const snapshot = await loadProfile(profileDir);
  const settings = applyModelOptions(snapshot.settings, cli);
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "lh-plot-preflight-"),
  );
  let model: RunManifest["model"];
  const secrets: string[] = [];
  try {
    const { configurePaths } = await import("../config.ts");
    configurePaths({
      dataDir: temporary,
      authFile: path.join(temporary, "unused-auth.json"),
    });
    const memory = await import("../src/store/memory-backend.ts");
    memory.resetMemoryStores();
    await memory.setMemoryKv("settings", settings);
    memory.setMemoryAuthContent(snapshot.authContent);
    const { replacePromptOverrideCache } =
      await import("../src/agent/prompt-segments.ts");
    replacePromptOverrideCache(snapshot.promptOverrides);
    const { initAuthEnv, providerKeyPresent } =
      await import("../src/server/keys.ts");
    await initAuthEnv();
    const { effectiveSettings } = await import("../src/server/stores.ts");
    await effectiveSettings();
    const strong = settings.models!.strong!;
    if (!providerKeyPresent(strong.model!.provider))
      throw new Error(
        `Selected provider ${strong.model!.provider} is not configured in this headless runtime`,
      );
    const { piEngineForSpec } = await import("../src/agent/models.ts");
    const engine = piEngineForSpec({
      ...strong.model!,
      thinkingLevel: strong.thinkingLevel,
    });
    model = {
      provider: engine.model.provider,
      id: engine.model.id,
      requestedThinking: strong.thinkingLevel ?? null,
      resolvedThinking: engine.level ?? null,
    };
    for (const [key, value] of Object.entries(process.env))
      if (
        /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
        value &&
        value.length > 8
      )
        secrets.push(value);
    if (snapshot.authContent)
      for (const value of Object.values(
        JSON.parse(snapshot.authContent) as Record<string, unknown>,
      ))
        if (typeof value === "string" && value.length > 8) secrets.push(value);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const redact = (value: string) =>
    secrets.reduce(
      (out, secret) => out.split(secret).join("[credential removed]"),
      value,
    );
  const out = path.resolve(
    cli.out ??
      path.join(
        root,
        "data",
        "plot-benchmark",
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
      ),
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(out, ".gitignore"), "*\n", { mode: 0o600 });
  const git = (gitArgs: string[]) =>
    execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" });
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(
      (file) =>
        file &&
        /^(src\/agent\/plot|scripts\/plot-benchmark|tests\/(plot|fixtures\/plot-benchmark)|docs\/plot-benchmark)/.test(
          file,
        ),
    );
  const lock = readJson(path.join(root, "package-lock.json")) as {
    packages: Record<string, { version?: string }>;
  };
  const names = [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "vega",
    "vega-lite",
    "vega-interpreter",
    "@resvg/resvg-js",
    "tsx",
    "typescript",
  ];
  const manifest: RunManifest = {
    schemaVersion: 1,
    caseSetVersion: set.caseSetVersion,
    caseSetHash: hash(JSON.stringify({ ...set, cases })),
    startedAt: new Date().toISOString(),
    endedAt: null,
    profileDir,
    repetitions: cli.repetitions,
    timeoutMs: cli.timeoutMs,
    model,
    settingsHash: hash(JSON.stringify(settings)),
    profileSettingsHash: hash(JSON.stringify(snapshot.settings)),
    promptOverridesHash: hash(JSON.stringify(snapshot.promptOverrides)),
    revision: git(["rev-parse", "HEAD"]).trim(),
    dirtyStatus: git(["status", "--porcelain"]),
    trackedDiffHash: hash(git(["diff", "HEAD", "--binary"])),
    untrackedHashes: Object.fromEntries(
      untracked.map((file) => [
        file,
        hash(fs.readFileSync(path.join(root, file))),
      ]),
    ),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    dependencies: Object.fromEntries(
      names.map((name) => [
        name,
        lock.packages[`node_modules/${name}`]?.version ?? "unknown",
      ]),
    ),
    cases,
  };
  writeJson(path.join(out, "manifest.json"), manifest);
  writeJson(path.join(out, "cases.json"), { ...set, cases });
  writeJson(path.join(out, "settings.json"), settings);
  writeJson(path.join(out, "prompt-overrides.json"), snapshot.promptOverrides);
  const results: CaseResult[] = [];
  console.log(
    `Benchmark ${model.provider}:${model.id} (${model.resolvedThinking ?? "default"}); ${cases.length * cli.repetitions} attempts`,
  );
  console.log(`Evidence: ${out}`);
  for (const c of cases)
    for (let attempt = 1; attempt <= cli.repetitions; attempt++) {
      const result = await superviseCase(
        {
          case: c,
          attempt,
          settings,
          promptOverrides: snapshot.promptOverrides,
          profileDir,
          outputDir: path.join(out, c.id, `attempt-${attempt}`),
          timeoutMs: cli.timeoutMs,
        },
        redact,
      );
      results.push(result);
      console.log(
        `${c.id} #${attempt}: ${result.outcome} (${result.timingsMs.total} ms)`,
      );
      await writeReport(out, manifest, results);
    }
  manifest.endedAt = new Date().toISOString();
  writeJson(path.join(out, "manifest.json"), manifest);
  await writeReport(out, manifest, results);
  console.log(`Report: ${path.join(out, "index.html")}`);
  if (results.some((r) => r.outcome === "infrastructure-failed")) return 2;
  return results.every((r) =>
    expectedCandidate(
      cases.find((c) => c.id === r.caseId)!,
      r,
    ),
  )
    ? 0
    : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "--internal-case") {
    // Parent-owned config contains no credentials and is never an agent prompt.
    void (async () => {
      const options = readJson(process.argv[3]!) as CaseRunOptions;
      const { runCase } = await import("./plot-benchmark/case-runner.ts");
      await runCase(options);
    })().then(
      () => process.exit(0),
      (error) => {
        // The parent scrubs credentials before retaining child diagnostics.
        console.error(
          error instanceof SyntaxError
            ? "Invalid JSON during case startup"
            : error instanceof Error
              ? error.message
              : "Case execution failed before completion",
        );
        process.exit(2);
      },
    );
  } else {
    void main(process.argv.slice(2)).then(
      (code) => {
        process.exitCode = code;
      },
      (error) => {
        // Preflight errors contain paths/model IDs, never arbitrary auth objects.
        console.error(
          error instanceof Error ? error.message : "Benchmark failed",
        );
        process.exitCode = 2;
      },
    );
  }
}
