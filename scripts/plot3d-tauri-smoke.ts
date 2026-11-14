import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--binary") || !process.argv.includes("--out"))
  throw new Error("Pass --binary and --out");
const binary = path.resolve(argument("--binary")!),
  out = path.resolve(argument("--out")!);
fs.mkdirSync(out, { recursive: true });
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plot3d-native-")),
  userDir = path.join(isolated, "user"),
  dataDir = path.join(isolated, "data");
fs.mkdirSync(userDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
const log = fs.openSync(path.join(out, "native.log"), "w");
const child = spawn(binary, [], {
  env: {
    ...process.env,
    CAIRN_USER_DATA_DIR: userDir,
    CAIRN_DATA_DIR: dataDir,
    CAIRN_AUTH_FILE: path.join(isolated, "auth.json"),
  },
  stdio: ["ignore", log, log],
});
let exited = false;
child.on("exit", () => {
  exited = true;
});
let launchError: Error | undefined;
child.on("error", (e) => {
  launchError = e;
});
const deadline = Date.now() + 120000,
  reportFile = path.join(userDir, "debug/plot3d-smoke/report.json");
try {
  while (
    !fs.existsSync(reportFile) &&
    Date.now() < deadline &&
    !exited &&
    !launchError
  )
    await new Promise((r) => setTimeout(r, 200));
  if (launchError) throw launchError;
  if (!fs.existsSync(reportFile))
    throw new Error(
      `Native smoke did not report within deadline (exited=${exited}); see ${out}/native.log`,
    );
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  for (const file of report.previews ?? []) {
    if (!/^(surface|helix|scatter|mixed)\.png$/.test(file))
      throw new Error("Unexpected evidence filename");
    const encoded = fs
      .readFileSync(
        path.join(path.dirname(reportFile), `${file}.base64`),
        "utf8",
      )
      .trim();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.readUInt32BE(16) !== 900 || bytes.readUInt32BE(20) !== 650)
      throw new Error("Invalid native PNG dimensions");
    fs.writeFileSync(path.join(out, file), bytes);
  }
  if (
    report.passed !== true ||
    report.checks.length < 26 ||
    report.previews.length !== 4
  )
    throw new Error(
      `Native smoke failed: ${report.error ?? JSON.stringify(report)}`,
    );
  console.log(
    JSON.stringify({ passed: true, checks: report.checks.length, out }),
  );
} finally {
  if (!exited) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!exited) child.kill("SIGKILL");
  }
  fs.closeSync(log);
}
