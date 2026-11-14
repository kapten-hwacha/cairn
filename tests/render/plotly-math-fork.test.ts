import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { DOMParser } from "linkedom";
import {
  buildFork,
  readSourceLock,
  verifyFile,
} from "../../scripts/plotly-math-fork/build.ts";
import {
  nativeHtml,
  assertTitleFits,
  titleSweepCameras,
  runNativeProbe,
  type Fixture,
} from "../../scripts/plotly-math-fork/probe.ts";
import {
  meshDigest,
  RECIPE,
  type PreparedAxisText,
} from "../../scripts/plotly-math-fork/contracts.ts";
const fixture = JSON.parse(
  fs.readFileSync(
    new URL(
      "../fixtures/visualization/plotly-native-math.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Fixture;
function mesh(source: string): PreparedAxisText {
  const data = {
    schemaVersion: 1 as const,
    source,
    recipe: RECIPE,
    positions: [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as Array<[number, number]>,
    cells: [[0, 1, 2]] as Array<[number, number, number]>,
    bounds: { widthEm: 1, heightEm: 1 },
    accessibleText: source,
  };
  return { ...data, meshHash: meshDigest(data) };
}
test("source lock verifies every patch and preparation helper; fresh-build guard preserves existing output", async () => {
  const lock = readSourceLock();
  assert.equal(lock.plotly.commit, "a929a77b3522887360671c30b270828a04cf4b81");
  assert.equal(Object.keys(lock.patches).length, 5);
  for (const [name, hash] of Object.entries(lock.patches))
    verifyFile(
      new URL("../../scripts/plotly-math-fork/patches" + name, import.meta.url)
        .pathname,
      hash,
    );
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "lh-native-build-contract-"),
  );
  try {
    fs.writeFileSync(path.join(dir, "keep"), "original");
    await assert.rejects(buildFork(dir), /Refusing existing/);
    assert.equal(fs.readFileSync(path.join(dir, "keep"), "utf8"), "original");
    assert.throws(
      () => verifyFile(path.join(dir, "keep"), "0".repeat(64)),
      /mismatch/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("portable HTML treats title/config data as data and does not load browser MathJax for native mode", () => {
  const source = "</script><script>window.injected=true</script>";
  const f = {
    ...fixture,
    labels: [source, fixture.labels[1]!, fixture.labels[2]!],
  };
  const meshes = f.labels.map(mesh);
  const html = nativeHtml("window.Plotly={};", f, meshes, mesh("$x^3$"), {
    kind: "surface",
    size: 20,
    width: 900,
    height: 650,
    prepared: true,
  });
  const doc = new DOMParser().parseFromString(html, "text/html");
  assert.equal(doc.querySelectorAll("script[src]").length, 0);
  assert.equal(doc.querySelectorAll("script").length, 2);
  assert.ok(html.includes("\\u003c/script>"));
  assert.ok(!html.includes("window.MathJax="));
  assert.throws(
    () =>
      nativeHtml("", fixture, meshes, mesh("z"), {
        kind: "surface",
        size: 20,
        width: 900,
        height: 650,
        prepared: true,
      }),
    /Fixture\/mesh mismatch/,
  );
});
test("missing build records failure and cannot overwrite earlier evidence", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "lh-native-probe-contract-"),
  );
  try {
    const out = path.join(dir, "out");
    assert.equal(await runNativeProbe(path.join(dir, "missing"), out), false);
    const result = JSON.parse(
      fs.readFileSync(path.join(out, "results.json"), "utf8"),
    );
    assert.equal(result.passed, false);
    assert.equal(result.cases.length, 0);
    assert.ok(result.errors.length);
    await assert.rejects(runNativeProbe(dir, out), /EEXIST/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const build = process.env.PLOTLY_MATH_BUILD_DIR;
test(
  "patched scene bridge rejects stale, malformed and cross-scene title inputs",
  { skip: build ? false : "Set PLOTLY_MATH_BUILD_DIR" },
  () => {
    const require = createRequire(import.meta.url);
    const select = require(
      path.join(build!, "src/plots/gl3d/prepared_text.js"),
    ) as (
      map: unknown,
      id: string,
      axes: { labels: string[] },
    ) => Array<PreparedAxisText | null>;
    const m = mesh("x");
    assert.equal(
      select({ scene: { xaxis: m } }, "scene", { labels: ["x", "y", "z"] })[0],
      m,
    );
    assert.deepEqual(select(null, "scene", { labels: ["x", "y", "z"] }), [
      null,
      null,
      null,
    ]);
    assert.deepEqual(
      select({ scene: { xaxis: m } }, "scene2", { labels: ["x", "y", "z"] }),
      [null, null, null],
    );
    for (const bad of [
      { bad: { xaxis: m } },
      { scene: { bad: m } },
      { scene: { xaxis: { ...m, source: "stale" } } },
      { scene: { xaxis: { ...m, positions: [] } } },
      { scene: { xaxis: { ...m, cells: [[0, 0, 0]] } } },
    ])
      assert.throws(
        () => select(bad, "scene", { labels: ["x", "y", "z"] }),
        /preparedAxisText/,
      );
  },
);

test(
  "CSS build IDs use relative paths and preserve serialized CSS",
  { skip: build ? false : "Set PLOTLY_MATH_BUILD_DIR" },
  () => {
    const require = createRequire(import.meta.url);
    const plugin = require(path.join(build!, "tasks/util/inline_css.js")) as (
      root: string,
    ) => {
      setup: (build: {
        onLoad: (
          filter: object,
          callback: (args: { path: string }) => {
            contents: string;
            loader: string;
          },
        ) => void;
      }) => void;
    };
    const roots = [
      fs.mkdtempSync(path.join(os.tmpdir(), "lh-css-a-")),
      fs.mkdtempSync(path.join(os.tmpdir(), "lh-css-b-")),
    ];
    try {
      const css = 'a::after{content:"` ${data} \\n"}';
      const outputs = roots.map((root) => {
        fs.writeFileSync(path.join(root, "test.css"), css);
        let load:
          | ((args: { path: string }) => { contents: string; loader: string })
          | undefined;
        plugin(root).setup({
          onLoad: (_filter, callback) => {
            load = callback;
          },
        });
        assert.throws(
          () => load!({ path: path.join(root, "..", "external.css") }),
          /outside/,
        );
        const output = load!({ path: path.join(root, "test.css") });
        // Execute the generated injection with a minimal DOM port: template-like
        // CSS content must reach textContent unchanged, without becoming JS.
        let inserted: unknown;
        const document = {
          getElementById: () => null,
          createElement: () => ({}),
          head: {
            appendChild: (el: unknown) => {
              inserted = el;
            },
          },
        };
        new Function("document", output.contents)(document);
        assert.equal((inserted as { textContent: string }).textContent, css);
        return output;
      });
      assert.deepEqual(outputs[0], outputs[1]);
    } finally {
      roots.forEach((root) =>
        fs.rmSync(root, { recursive: true, force: true }),
      );
    }
  },
);

test("camera sweep covers the approved poses deterministically at fixed radius", () => {
  const poses = titleSweepCameras(fixture.titleBoundsSweep);
  assert.equal(poses.length, 36);
  assert.deepEqual(poses, titleSweepCameras(fixture.titleBoundsSweep));
  for (const pose of poses) {
    assert.ok(
      Math.abs(Math.hypot(pose.eye.x, pose.eye.y, pose.eye.z) - 2.5) < 1e-12,
    );
    assert.ok(
      Math.abs(pose.eye.z - 2.5 * Math.sin((pose.elevation * Math.PI) / 180)) <
        1e-12,
    );
  }
  assert.throws(
    () => titleSweepCameras({ ...fixture.titleBoundsSweep, radius: NaN }),
    /Invalid title-bounds/,
  );
});
test("title inspection rejects overflow, stale and invalid bounds with their field path", () => {
  const title = {
    fieldPath: "scene2.zaxis.title",
    meshHash: "abc",
    fits: true,
    angleRadians: 0,
    shiftClip: [0, 0],
    inkBoundsClip: [-0.5, -0.5, 0.5, 0.5],
  };
  const scene = {
    hashes: ["abc"],
    counts: [3],
    uploads: 1,
    resolution: [100, 100],
    pixelScale: 1,
    titles: [title],
  };
  assertTitleFits({ error: null, scenes: [[scene]] });
  for (const patch of [
    { fits: false },
    { meshHash: "stale" },
    { inkBoundsClip: [-2, -0.5, 0.5, 0.5] },
    { shiftClip: [NaN, 0] },
  ])
    assert.throws(
      () =>
        assertTitleFits({
          error: null,
          scenes: [[{ ...scene, titles: [{ ...title, ...patch }] }]],
        }),
      /scene2.zaxis.title:/,
    );
});
