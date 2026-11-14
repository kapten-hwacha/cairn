import assert from "node:assert/strict";
import { test } from "node:test";
import {
  headlessOverride,
  realHeadless,
} from "../../src/agent/subagents/headless.ts";
import { createWorkerHeadless } from "../../src/worker/headless-worker.ts";
import {
  preparePlot3DAxisText,
  validatePreparedAxisText,
} from "../../src/agent/plot3d-labels.ts";
test("portable contour keeps fractions, radicals, subscripts and holes with identical native/WASM meshes", async () => {
  try {
    for (const label of [
      "$\\frac{x^2}{8}$",
      "$\\sqrt{y_0}$",
      "$z$ (m)",
      "$y_0$",
      "$\\sqrt{x}$",
    ]) {
      headlessOverride.current = realHeadless;
      const native = await preparePlot3DAxisText(label, "axis");
      headlessOverride.current = createWorkerHeadless();
      const wasm = await preparePlot3DAxisText(label, "axis");
      assert.deepEqual(wasm, native);
      await validatePreparedAxisText(wasm, "axis");
      const bad = structuredClone(wasm);
      bad.positions[0]![0] += 1;
      await assert.rejects(
        () => validatePreparedAxisText(bad, "axis"),
        /hash|winding|bounds/,
      );
    }
  } finally {
    delete headlessOverride.current;
  }
});

test("coverage rejects filled glyph holes even when total IoU remains high", async () => {
  const { checkMeshCoverage } = await import("../../src/agent/plot3d-labels.ts");
  const width = 100,
    height = 100,
    reference = new Uint8Array(width * height).fill(255),
    actual = new Uint8Array(width * height * 4).fill(255);
  for (let y = 45; y < 55; y++)
    for (let x = 45; x < 55; x++) reference[y * width + x] = 0;
  assert.throws(
    () => checkMeshCoverage(reference, actual, width, height),
    /filled hole pixels/,
  );
});
