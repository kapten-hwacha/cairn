import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validatePlot3DInput,
  validatePlot3DPng,
  validatePlot3DVerification,
  type Plot3DInput,
} from "../../src/core/contracts/plot3d.ts";
const input: Plot3DInput = {
  kind: "3d",
  title: "Data",
  xLabel: "$x$",
  yLabel: "$y$",
  zLabel: "$z$",
  xDomain: [-2, 2],
  yDomain: [-2, 2],
  zDomain: [-2, 2],
  series: [
    { kind: "scatter", label: "Samples", points: [{ x: 0, y: 1, z: 2 }] },
  ],
};
test("3D contract accepts finite scatter and rejects invalid domains/points/seeds", () => {
  validatePlot3DInput(input);
  assert.throws(
    () => validatePlot3DInput({ ...input, xDomain: [1, 1] }),
    /xDomain/,
  );
  assert.throws(
    () =>
      validatePlot3DInput({
        ...input,
        series: [
          { kind: "scatter", label: "Data", points: [{ x: NaN, y: 0, z: 0 }] },
        ],
      }),
    /points\[0\]/,
  );
  assert.throws(
    () =>
      validatePlot3DInput({
        ...input,
        series: [
          {
            kind: "parametric",
            label: "Curve",
            xExpression: "u",
            yExpression: "u",
            zExpression: "u",
            uDomain: [0, 1],
            sampleAtU: [2],
          },
        ],
      }),
    /sampleAtU/,
  );
  assert.throws(
    () =>
      validatePlot3DInput({
        ...input,
        series: [
          {
            kind: "surface",
            label: "Plane",
            expression: "x+y",
            xDomain: [-3, 1],
          },
        ],
      }),
    /inside/,
  );
});
test("3D capture rejects missing proof, forged provenance and non-PNG preview", () => {
  const expected = {
    rendererVersion: "4.3.0",
    sceneHash: "abc",
    titleHashes: ["x", "y", "z"],
    width: 900 as const,
    height: 650 as const,
  };
  assert.throws(
    () =>
      validatePlot3DVerification(
        { ready: true, ...expected, sceneHash: "forged", errors: [] },
        expected,
      ),
    /verification/,
  );
  assert.throws(
    () => validatePlot3DPng("data:image/png;base64,AAAA"),
    /signature/,
  );
  assert.throws(
    () => validatePlot3DPng("data:image/svg+xml;base64,AAAA"),
    /PNG/,
  );
});
