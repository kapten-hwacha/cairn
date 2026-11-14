import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DOMParser } from "linkedom";
import {
  buildProbeHtml,
  runProbe,
  type ProbeFixture,
} from "../../scripts/plotly-latex-probe.ts";

const fixture: ProbeFixture = {
  schemaVersion: 1,
  labels: ["$x$", "$y$", "$z$"],
  initialCamera: { x: 1, y: 1, z: 1 },
  actions: ["initial", "rotate", "zoom"],
};

test("probe serializes labels as data and includes libraries without remote script URLs", () => {
  const tricky = {
    ...fixture,
    labels: ["</script><script>window.injected=true</script>", "$y$", "$z$"],
  };
  const html = buildProbeHtml(
    "window.Plotly={};",
    "window.MathJax={};",
    tricky,
    "annotations",
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  assert.equal(document.querySelectorAll("script[src]").length, 0);
  assert.equal(document.querySelectorAll("script").length, 4);
  assert.ok(html.includes("\\u003c/script>"));
  assert.ok(html.includes("window.__probe.conversions++"));
});

test("probe rejects invalid fixture geometry and records missing inputs without claiming a runtime pass", async () => {
  assert.throws(
    () =>
      buildProbeHtml(
        "",
        "",
        { ...fixture, initialCamera: { x: NaN, y: 1, z: 1 } },
        "native",
      ),
    /Invalid probe fixture/,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-probe-contract-"));
  try {
    const out = path.join(dir, "evidence");
    assert.equal(await runProbe(path.join(dir, "missing-package"), out), false);
    const report = JSON.parse(
      fs.readFileSync(path.join(out, "results.json"), "utf8"),
    );
    assert.match(report.error, /ENOENT/);
    assert.deepEqual(report.cases, []);
    await assert.rejects(
      runProbe(path.join(dir, "missing-package"), out),
      /EEXIST/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
