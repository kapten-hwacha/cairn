# Native math title bounds: approved follow-up

**Status:** approved by “implement the title-bounds fix”, 2026-11-13.
The fifth prototype patch is implemented, built and verified. This is not product
integration.

The completed prototype passes 109/110 cases. One 450x325 sandboxed surface,
with 12px titles and device scale 2, loses a title in raw export. Camera
synchronization fixed five earlier failures but did not eliminate this one.
See [measured evidence](plotly-latex-investigation.md).

Completion evidence: six projection/bounds tests and 25 focused tests pass.
All **110/110 runtime matrix cases** and **108/108 camera-sweep observations**
pass, including the formerly failing small-view case. The full probe exits 0
with `passed: true`, zero unexpected page/network errors and no repeated math
preparation. All 18 performance configurations completed their five measured
repetitions after warm-up. A separate oversized-title browser check produced
the expected field-specific fit failure without an uncaught render-loop error.
Clean
builds `/private/tmp/learnharness-plotly-title-bounds-01` and `-02` are
byte-identical. Review the full matrix, sweep and performance evidence in
`data/visualization-review/plotly-title-bounds-01/index.html`, `results.json`,
`performance-summary.json` and `build-reproducibility.json`. The negative
oversize check is in `data/visualization-review/plotly-title-bounds-overflow-01`.
The GLSL formatter lockfile is maintained at
`scripts/plotly-math-fork/glsl-tools-package-lock.json`; tool packages are installed
only inside the disposable checkout.

Observed surface update medians were 11.8ms for one figure and 23.6ms for two,
versus 11.7ms / 23.6ms for the matching unpatched control. All native timing runs
recorded zero math conversions. These remain exploratory Chrome observations,
not a product FPS budget. Native bundle size is 1,733,127 raw / 555,380 gzip
bytes, adding 3,672 raw / 1,107 gzip bytes over the four-patch math prototype.
Some edge views remain crowded and 12px fractions remain small: this patch
bounds whole titles and does not solve general collision handling or typography.

## Proposed behavior and tradeoff

For a prepared mathematical title, retain native placement whenever its complete
rotated ink bounds fit inside the GL viewport. Otherwise shift the **whole title**
by the minimum screen displacement that puts its bounds inside a **2 CSS pixel
inset**. Preserve glyph shape, font size, orientation, camera and plotted data.
Ordinary native text and ticks keep their existing path.

This can move a title closer to the grid or ticks near an edge. It does not
resolve arbitrary label collisions. Review the resulting images before adopting
it. The alternative is a larger minimum interactive viewport; that would require
a separate small-card/mobile UX policy. The recommendation is to test the bounded
title shift first.

If the complete title cannot fit, return an explicit fit failure to the prototype
inspector for `scene.xaxis.title`, `scene.yaxis.title` or `scene.zaxis.title`.
Do not shrink, wrap, crop, stretch or silently certify the figure. Product-facing
error presentation remains outside this experiment.

## Exact files and internal contract

Create:

- `scripts/plotly-math-fork/patches/gl-axes3d-title-bounds.patch`.
- `tests/plotly-title-bounds.test.ts`.

Update:

- `scripts/plotly-math-fork/sources.lock.json`: fifth patch hash and original
  shader preimage; preserve all four existing patch/source pins.
- `scripts/plotly-math-fork/build.ts`: apply the fifth patch only to the native
  build; include its new JS helper in syntax/lint/format/type checks.
- `scripts/plotly-math-fork/probe.ts`: report per-title fit status and complete
  projected bounds; make overflow fail inspection with the title's field path.
- `tests/fixtures/visualization/plotly-native-math.json`: deterministic camera
  sweep described below; retain the existing 110-case corpus.

In the disposable axes source, create `lib/title-bounds.js` and modify
`lib/text.js` and `lib/shaders/textVert.glsl`. No new teacher input or product
result field is introduced.

The pure helper exports `computeTitleViewportAdjustment(options)`, consuming:

- Native model/view/projection matrices and title anchor offset.
- Actual prepared-vertex ink bounds, including the existing y inversion.
- Native font scale, pixel scale and drawing-buffer resolution.
- Native angle, alignment direction and alignment options.
- Inset fixed at 2 CSS pixels, converted using the native pixel scale.

It returns `{ fits, angleRadians, shiftClip: [dx, dy], inkBoundsClip: [left,
bottom, right, top] }`. Invalid/nonfinite transforms produce an explicit error;
an oversized box returns `fits: false` and zero shift.

Compute the native title angle using the same projection/alignment rules as the
pinned shader, then project the four ink-box corners. Find the nearest anchor
whose complete box lies within the inset rectangle. Move the anchor uniformly;
never clamp vertices separately. Do not alter projected depth.

`TextSprites.bind` retains the current transform/resolution references for the
draw call. `drawLabel` computes the adjustment from cached ink bounds; no mesh
preparation or GPU geometry rebuild occurs. For prepared titles, pass the
resolved angle and uniform clip shift to the shader so CPU bounds and GPU
orientation use the same angle. For ordinary titles/ticks, disable these new
uniforms and use the unchanged native shader logic. Record fit status per axis
for inspection; oversized boxes must not produce an uncaught animation-loop
exception. Disposal remains owned by the existing text sprites.

## Verification

Unit tests cover unchanged in-bounds placement, each edge/corner, rotated titles,
all native alignment modes, non-square viewports, pixel scales 1/2, oversized
titles, invalid matrices and preserved mesh/hash/font/camera/data. Compare corner
positions before/after: every corner receives the same shift and remains inside
the inset when `fits` is true. Test a known one-em calibration box.

Add a deterministic camera sweep at radius 2.5: azimuths 30, 60, ... 360 degrees
and elevations 15, 35, 65 degrees. Exercise all three scene types at 450x325,
12px titles, device scale 2, opaque app-CSP sandbox. Save each PNG and its bounds.
This complements actual mouse drag/wheel interaction in the existing corpus.
Export SVG and 1800x1300 PNG at the first/last azimuth of each elevation too.
Manually inspect edge views for crowding and axis association.

Rerun the existing full matrix, raw PNG/SVG checks, figure/scene isolation,
replacement/removal/resize/purge, offline/CSP checks and performance comparisons.
Require zero runtime failures, zero repeated math preparation and no new network
or console errors. Record performance deltas without inventing an FPS budget.

Commands from the LearnHarness root, using fresh directories:

```sh
node --import tsx scripts/plotly-math-fork/build.ts --work-dir /private/tmp/learnharness-plotly-title-bounds-01
PLOTLY_MATH_BUILD_DIR=/private/tmp/learnharness-plotly-title-bounds-01 NODE_ENV=test node --import tsx --test tests/plotly-title-bounds.test.ts tests/plotly-math-mesh.test.ts tests/plotly-math-fork.test.ts tests/plotly-latex-probe.test.ts tests/plot-labels.test.ts
node --import tsx scripts/plotly-math-fork/probe.ts --build-dir /private/tmp/learnharness-plotly-title-bounds-01 --out data/visualization-review/plotly-title-bounds-01
npm exec -- prettier --write scripts/plotly-math-fork tests/plotly-title-bounds.test.ts tests/fixtures/visualization/plotly-native-math.json
npm exec -- prettier --check scripts/plotly-math-fork tests/plotly-title-bounds.test.ts tests/fixtures/visualization/plotly-native-math.json
npm exec -- eslint --no-ignore --fix scripts/plotly-math-fork tests/plotly-title-bounds.test.ts
npm exec -- eslint --no-ignore scripts/plotly-math-fork tests/plotly-title-bounds.test.ts
npm run typecheck
git diff --check
```

Use the existing checkout-local Biome and focused `checkJs` configuration for the
patched JS. For GLSL, install `prettier-plugin-glsl@0.3.1` with Prettier `3.10.1`
in the disposable checks-tools directory, recording its own lockfile/integrities;
do not change LearnHarness or upstream manifests. Run the plugin formatter in
write/check modes. GLSL parsing through the pinned shader build and actual
WebGL compilation/linking supply syntax/type validation; browser checks must
reject any shader compile/link error. Re-export formatted patches and compare
two clean builds again. Preserve all previous experiment evidence.

Approval authorizes this bounded fifth-patch experiment and the stated
placement/overflow policy. Backend adoption, wider collision handling, worker/
WebView integration and the full visualization implementation remain separate.
