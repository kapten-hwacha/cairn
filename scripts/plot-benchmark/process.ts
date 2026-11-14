import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  initialResult,
  type CaseResult,
  type CaseRunOptions,
} from "./contracts.ts";
import { readJson, writeJson } from "./io.ts";

/** Independent watchdog: a blocked renderer cannot strand the suite. */
export async function superviseCase(
  options: CaseRunOptions,
  redact: (value: string) => string = (value) => value,
  command: { executable: string; args: string[] } = {
    executable: process.execPath,
    args: [
      "--experimental-sqlite",
      "--import",
      "tsx",
      fileURLToPath(new URL("../plot-benchmark.ts", import.meta.url)),
      "--internal-case",
      path.join(options.outputDir, "options.json"),
    ],
  },
): Promise<CaseResult> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  writeJson(path.join(options.outputDir, "options.json"), options);
  writeJson(
    path.join(options.outputDir, "result.json"),
    initialResult(options.case.id, options.attempt),
  );
  const start = performance.now();
  let timedOut = false;
  let log = "";
  const child = spawn(command.executable, command.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CAIRN_DATA_DIR: path.join(options.outputDir, "isolated-data"),
      CAIRN_PROVIDER_EVENTS: "",
    },
  });
  const capture = (chunk: Buffer) => {
    log = (log + chunk.toString("utf8")).slice(-64 * 1024);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const watchdog = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs + 5_000);
  let spawnError = false;
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", () => {
      spawnError = true;
      resolve(null);
    });
    child.once("close", resolve);
  });
  clearTimeout(watchdog);
  fs.writeFileSync(
    path.join(options.outputDir, "diagnostics.log"),
    redact(log),
    { mode: 0o600 },
  );
  let result = initialResult(options.case.id, options.attempt);
  try {
    const saved = readJson(
      path.join(options.outputDir, "result.json"),
    ) as CaseResult;
    if (
      saved.schemaVersion === 1 &&
      saved.caseId === options.case.id &&
      saved.attempt === options.attempt
    )
      result = saved;
  } catch {
    /* An interrupted checkpoint is an infrastructure result. */
  }
  if (timedOut || code !== 0 || spawnError) {
    result.outcome = timedOut ? "timed-out" : "infrastructure-failed";
    result.failureStage = timedOut
      ? result.failureStage === "infrastructure"
        ? null
        : result.failureStage
      : "infrastructure";
    result.reason = timedOut
      ? "Parent deadline terminated the case; partial evidence retained"
      : "Case process failed; see diagnostics.log";
    result.cost.complete = false;
    result.cost.usd = null;
  }
  result.timingsMs.total = Math.round(performance.now() - start);
  result.evidence.files = [
    ...new Set([
      ...result.evidence.files,
      "diagnostics.log",
      "options.json",
      "result.json",
    ]),
  ];
  writeJson(path.join(options.outputDir, "result.json"), result);
  return result;
}
