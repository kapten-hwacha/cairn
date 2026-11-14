import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  LIMITS,
  RECIPE,
  meshDigest,
  validateMesh,
  type PreparedAxisText,
} from "../../scripts/plotly-math-fork/contracts.ts";
import {
  compareCoverage,
  prepareWithEvidence,
  prepareAxisText,
} from "../../scripts/plotly-math-fork/prepare-mesh.ts";
const small = (): PreparedAxisText => {
  const data = {
    schemaVersion: 1 as const,
    source: "x",
    recipe: RECIPE,
    positions: [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as Array<[number, number]>,
    cells: [[0, 1, 2]] as Array<[number, number, number]>,
    bounds: { widthEm: 1, heightEm: 1 },
    accessibleText: "x",
  };
  return { ...data, meshHash: meshDigest(data) };
};
test("prepared meshes reject invalid metadata, vertices, indices, winding, hash and resource limits", () => {
  validateMesh(small(), "scene.xaxis");
  const mutations: Array<(m: PreparedAxisText) => void> = [
    (m) => {
      m.positions[0]![0] = NaN;
    },
    (m) => {
      m.cells[0]![1] = 8;
    },
    (m) => {
      m.cells[0] = [0, 0, 1];
    },
    (m) => {
      m.cells[0] = [2, 1, 0];
    },
    (m) => {
      m.meshHash = "0".repeat(64);
    },
    (m) => {
      m.source = "x".repeat(LIMITS.source + 1);
    },
    (m) => {
      m.positions = Array.from({ length: LIMITS.vertices + 1 }, () => [0, 0]);
    },
    (m) => {
      m.cells = Array.from({ length: LIMITS.triangles + 1 }, () => [0, 1, 2]);
    },
    (m) => {
      m.accessibleText = "x".repeat(LIMITS.bytes);
    },
    (m) => {
      m.bounds.widthEm = Infinity;
    },
  ];
  for (const mutate of mutations) {
    const m = small();
    mutate(m);
    assert.throws(() => validateMesh(m, "scene.xaxis"), /scene.xaxis:/);
  }
});
const build = process.env.PLOTLY_MATH_BUILD_DIR;
test(
  "pinned converter preserves label shape, proportions and glyph holes",
  {
    skip: build
      ? false
      : "Set PLOTLY_MATH_BUILD_DIR to a verified scratch build",
  },
  async () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        new URL(
          "../fixtures/visualization/plotly-native-math.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { corpus: string[] };
    for (const [i, source] of fixture.corpus.entries()) {
      const e = await prepareWithEvidence(
        source,
        `corpus[${i}]`,
        path.join(build!, "stackgl_modules"),
      );
      assert.ok(e.coverage.iou >= 0.98, `${source}: IoU ${e.coverage.iou}`);
      if (source === "B8O0") {
        assert.ok(e.coverage.holes >= 6);
        assert.equal(e.coverage.filledHolePixels, 0);
      }
      validateMesh(JSON.parse(JSON.stringify(e.mesh)), `corpus[${i}]`);
      if (i === 0)
        assert.equal(
          (
            await prepareAxisText(
              source,
              "repeat",
              path.join(build!, "stackgl_modules"),
            )
          ).meshHash,
          e.mesh.meshHash,
        );
    }
  },
);
test(
  "preparation rejects invalid labels with their field path",
  { skip: build ? false : "Set PLOTLY_MATH_BUILD_DIR" },
  async () => {
    for (const source of [
      "",
      "$\\notARealCommand$",
      "$x",
      "😀",
      "x".repeat(2049),
      "x\n".repeat(100),
    ])
      await assert.rejects(
        prepareWithEvidence(
          source,
          "scene.zaxis",
          path.join(build!, "stackgl_modules"),
        ),
        /scene.zaxis:/,
      );
  },
);

test("coverage calibration preserves one-em scale and detects filled hole interiors", () => {
  const positions: Array<[number, number]> = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    cells: Array<[number, number, number]> = [
      [0, 1, 2],
      [0, 2, 3],
    ];
  const width = 272,
    alpha = new Uint8Array(width * width);
  for (let y = 8; y < 264; y++)
    for (let x = 8; x < 264; x++) alpha[y * width + x] = 255;
  assert.ok(
    compareCoverage({ positions, cells }, alpha, width, width).iou >= 0.98,
  );
  for (let y = 80; y < 192; y++)
    for (let x = 80; x < 192; x++) alpha[y * width + x] = 0;
  const bad = compareCoverage({ positions, cells }, alpha, width, width);
  assert.equal(bad.holes, 1);
  assert.ok(bad.filledHolePixels > 10000);
});
