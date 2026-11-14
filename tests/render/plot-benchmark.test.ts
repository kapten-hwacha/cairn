import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { main } from "../../scripts/plot-benchmark.ts";
import {
  caseSetSchema,
  parseArgs,
  selectCases,
  applyModelOptions,
  initialResult,
  type BenchmarkCase,
  type CaseRunOptions,
  type RunManifest,
} from "../../scripts/plot-benchmark/contracts.ts";
import { loadProfile } from "../../scripts/plot-benchmark/profile.ts";
import { superviseCase } from "../../scripts/plot-benchmark/process.ts";
import { writeReport } from "../../scripts/plot-benchmark/report.ts";
import { writeJson, readJson } from "../../scripts/plot-benchmark/io.ts";

const fixture = caseSetSchema.parse(
  readJson("tests/fixtures/plot-benchmark/cases.json"),
);
const example = fixture.cases[0]!;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lh-benchmark-test-"));
const settings = {
  version: 1,
  models: {
    strong: {
      model: { provider: "deepseek", id: "deepseek-flash" },
      thinkingLevel: "high" as const,
    },
  },
};
const manifest = (c: BenchmarkCase): RunManifest => ({
  schemaVersion: 1,
  caseSetVersion: "test",
  caseSetHash: "hash",
  startedAt: "now",
  endedAt: null,
  profileDir: "/profile",
  repetitions: 1,
  timeoutMs: 100,
  model: {
    provider: "deepseek",
    id: "deepseek-flash",
    requestedThinking: "high",
    resolvedThinking: "high",
  },
  settingsHash: "hash",
  profileSettingsHash: "hash",
  promptOverridesHash: "hash",
  revision: "rev",
  dirtyStatus: "",
  trackedDiffHash: "hash",
  untrackedHashes: {},
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  dependencies: {},
  cases: [c],
});

test("fixtures cover twelve cases and reject malformed or duplicate expectations", () => {
  assert.equal(fixture.cases.length, 12);
  assert.equal(
    fixture.cases.filter((c) => c.partition === "held-out").length,
    2,
  );
  assert.throws(() => caseSetSchema.parse({ ...fixture, schemaVersion: 2 }));
  assert.throws(
    () => caseSetSchema.parse({ ...fixture, cases: [example, example] }),
    /Duplicate/,
  );
  assert.throws(() =>
    caseSetSchema.parse({ ...fixture, cases: [{ ...example, prompt: " " }] }),
  );
  assert.throws(() =>
    caseSetSchema.parse({
      ...fixture,
      cases: [
        {
          ...example,
          review: {
            ...example.review,
            landmarks: [
              { description: "bad", x: Infinity, y: 0, tolerance: -1 },
            ],
          },
        },
      ],
    }),
  );
  assert.throws(() => selectCases(fixture, ["unknown"]), /Unknown case/);
});

test("CLI accepts independent model/thinking overrides without changing source settings or fixtures", () => {
  const cli = parseArgs([
    "--profile-dir",
    "/profile",
    "--model",
    "openrouter:vendor/model:variant",
    "--thinking",
    "low",
    "--case",
    example.id,
  ]);
  const overridden = applyModelOptions(settings, cli);
  assert.deepEqual(overridden.models?.strong?.model, {
    provider: "openrouter",
    id: "vendor/model:variant",
  });
  assert.equal(overridden.models?.strong?.thinkingLevel, "low");
  assert.equal(settings.models.strong.model.provider, "deepseek");
  assert.equal(
    applyModelOptions(settings, {}).models?.strong?.model?.id,
    "deepseek-flash",
  );
  for (const args of [
    ["--unknown"],
    ["--profile-dir"],
    ["--profile-dir", "x", "--repetitions", "0"],
    ["--profile-dir", "x", "--timeout-ms", "Infinity"],
    ["--profile-dir", "x", "--model", "bad"],
    ["--profile-dir", "x", "--thinking", "extreme"],
    ["--profile-dir", "x", "--profile-dir", "y"],
    ["--report-only", "x", "--model", "a:b"],
  ])
    assert.throws(() => parseArgs(args));
  assert.throws(
    () => applyModelOptions({ version: 1 }, {}),
    /No conversation model/,
  );
});

test("profile reads SQLite settings and overrides without mutating the database or exposing invalid credentials", async () => {
  const dir = tmp();
  try {
    const dbFile = path.join(dir, "learnharness.db");
    const db = new DatabaseSync(dbFile);
    db.exec(
      "CREATE TABLE kv_documents (key TEXT PRIMARY KEY, value_json TEXT); CREATE TABLE prompt_overrides (segment_path TEXT PRIMARY KEY, content TEXT)",
    );
    db.prepare("INSERT INTO kv_documents VALUES ('settings', ?)").run(
      JSON.stringify(settings),
    );
    db.prepare("INSERT INTO prompt_overrides VALUES (?, ?)").run(
      "teacher/50-demos.md",
      "Custom plotting prompt",
    );
    db.close();
    const before = fs.readFileSync(dbFile);
    writeJson(path.join(dir, "data", "settings.json"), {
      models: { strong: { model: { provider: "wrong", id: "stale" } } },
    });
    writeJson(path.join(dir, "auth.json"), {
      DEEPSEEK_API_KEY: "secret-sentinel-do-not-save",
    });
    const loaded = await loadProfile(dir);
    assert.equal(loaded.settings.models?.strong?.model?.id, "deepseek-flash");
    assert.equal(
      loaded.promptOverrides["teacher/50-demos.md"],
      "Custom plotting prompt",
    );
    assert.deepEqual(fs.readFileSync(dbFile), before);
    assert.ok(loaded.authContent?.includes("secret-sentinel"));
    fs.writeFileSync(
      path.join(dir, "auth.json"),
      "secret-sentinel-is-invalid-json",
    );
    await assert.rejects(
      loadProfile(dir),
      (error) =>
        error instanceof Error &&
        error.message === "Profile credential store is not valid JSON",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed CLI or unknown fixture ID fails before reading a profile or making requests", async () => {
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("unexpected network");
  };
  try {
    await assert.rejects(
      main(["--profile-dir", "/nonexistent", "--case", "not-a-case"]),
      /Unknown case/,
    );
    await assert.rejects(
      main(["--profile-dir", "/nonexistent", "--model", "invalid"]),
      /provider:model-id/,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("report escapes model text, preserves manual review and keeps missing cost unknown", async () => {
  const dir = tmp();
  const c = { ...example, prompt: '<script>alert("fixture")</script>' };
  const result = initialResult(c.id, 1);
  result.reason = '<img src=x onerror="alert(1)">';
  result.evidence.artifacts = [
    {
      jobId: "plot",
      kind: "plot",
      file: "artifacts/plot.svg",
      delivered: false,
    },
  ];
  result.evidence.files = ["chat.json", "../../auth.json"];
  writeJson(path.join(dir, c.id, "attempt-1", "view.json"), [
    {
      role: "assistant",
      parts: [{ type: "text", text: "<script>model</script>" }],
    },
  ]);
  try {
    await writeReport(dir, manifest(c), [result]);
    let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes('href="01-sine/attempt-1/../../auth.json"'));
    assert.ok(html.includes('<img src="01-sine/attempt-1/artifacts/plot.svg"'));
    assert.ok(html.includes("Unknown/incomplete"));
    const key = `${c.id}/attempt-1`;
    const reviews = readJson(path.join(dir, "review.json")) as Record<
      string,
      unknown
    >;
    reviews[key] = {
      correctness: "fail",
      readability: "pass",
      misleading: "yes",
      notes: "User review stays intact",
    };
    writeJson(path.join(dir, "review.json"), reviews);
    await writeReport(dir, manifest(c), [result]);
    html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(html.includes("User review stays intact"));
    const merged = readJson(path.join(dir, "results.json")) as Array<{
      review: unknown;
    }>;
    assert.deepEqual(merged[0]!.review, reviews[key]);
    assert.equal(result.review.correctness, "pending");
    reviews[key] = { correctness: "automatically-passed" };
    writeJson(path.join(dir, "review.json"), reviews);
    await assert.rejects(writeReport(dir, manifest(c), [result]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("report-only regenerates all attempts without inference", async () => {
  const dir = tmp();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("report-only attempted inference");
  };
  try {
    writeJson(path.join(dir, "manifest.json"), manifest(example));
    writeJson(
      path.join(dir, example.id, "attempt-1", "result.json"),
      initialResult(example.id, 1),
    );
    assert.equal(await main(["--report-only", dir]), 0);
    assert.ok(
      fs
        .readFileSync(path.join(dir, "index.html"), "utf8")
        .includes("1 attempts"),
    );
  } finally {
    globalThis.fetch = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saved provider schema rejection is classified as invocation without changing raw evidence", async () => {
  const dir = tmp();
  try {
    const raw = initialResult(example.id, 1);
    raw.reason = "Model request failed: 400 Invalid schema for function 'plot'";
    await writeReport(dir, manifest(example), [raw]);
    const results = readJson(path.join(dir, "results.json")) as Array<{
      failureStage: string;
    }>;
    assert.equal(results[0]!.failureStage, "invocation");
    assert.equal(raw.failureStage, "infrastructure");
    const analysis = readJson(path.join(dir, "analysis.json")) as {
      failureStages: Record<string, number>;
    };
    assert.equal(analysis.failureStages.invocation, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parent watchdog terminates a stalled child and retains partial evidence with unknown cost", async () => {
  const dir = tmp();
  try {
    const options: CaseRunOptions = {
      case: example,
      attempt: 1,
      settings,
      promptOverrides: {},
      profileDir: dir,
      outputDir: path.join(dir, "attempt"),
      timeoutMs: 1,
    };
    const script = `const fs=require('fs'),p=require('path'),d=process.argv[1],f=p.join(d,'result.json');const r=JSON.parse(fs.readFileSync(f));r.evidence.artifacts=[{jobId:'partial',kind:'plot',file:'artifacts/partial.svg',delivered:false}];r.cost={usd:1,source:'catalog-estimate',complete:true};fs.writeFileSync(f,JSON.stringify(r));console.log('secret-sentinel');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`;
    const result = await superviseCase(
      options,
      (s) => s.replaceAll("secret-sentinel", "[removed]"),
      { executable: process.execPath, args: ["-e", script, options.outputDir] },
    );
    assert.equal(result.outcome, "timed-out");
    assert.equal(result.evidence.artifacts[0]?.jobId, "partial");
    assert.equal(result.cost.usd, null);
    assert.equal(result.cost.complete, false);
    assert.ok(
      !fs
        .readFileSync(path.join(options.outputDir, "diagnostics.log"), "utf8")
        .includes("secret-sentinel"),
    );
    assert.ok(result.timingsMs.total < 10_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
