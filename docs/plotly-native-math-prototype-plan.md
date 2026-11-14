# Plotly native math: isolated fork prototype plan

**Status (2026-11-13): approved prototype completed; 109/110 runtime cases pass.**
The user approved this isolated prototype with “go ahead”, then explicitly
approved the deterministic CSS build fix described in the addendum below.
Product integration and final backend selection remain outside this approval.

**Goal:** prove that prepared mathematical axis titles can use Plotly's native
3D placement, drawing and raw export, with no typesetting during interaction.

Use the writing-plans workflow. Preserve the dirty tree and completed 2D pipeline.
No commits, publication, dependency changes in LearnHarness, teacher-tool changes,
product integration or broad SVG-text refactor are part of this approval.

## Source pins and build ownership

| Component         | Exact source                                                                            |
| ----------------- | --------------------------------------------------------------------------------------- |
| Plotly            | `v4.3.0`, peeled commit `a929a77b3522887360671c30b270828a04cf4b81`                      |
| Native axes       | npm `gl-axes3d@1.7.1`, package git head `4f2b6061d18fcea3fac41a3f0915a955bb7ac287`      |
| Contour converter | npm `vectorize-text@3.2.2`, package git head `2f8f8eca90a95e1212605ea6d403f3ed7eb90333` |
| Label preparation | existing `typesetPlotLabel`, MathJax/font `4.1.3`, installed resvg `2.6.2`              |

These were checked against the release sources and npm tarball integrity, rather
than inferred from upstream master. Preserve both upstream lockfiles. The pinned
stack.gl lock resolves `gl-plot3d@2.4.7`, webpack `5.110.3`, CLI `7.2.3`.
Record actual Node/npm/Chrome versions in every build/probe manifest. The current
host has Node `26.13.1` and npm `11.20.0`; a build failure is evidence to resolve,
not permission to upgrade pinned dependencies silently.

The build uses a **separate disposable checkout supplied with `--work-dir`**.
Refuse an existing directory. Store the maintained fork as reviewable patches in
this repository; do not create a public fork yet. Install release dependencies
with `npm ci` in that checkout. Extract the integrity-checked axes tarball into
`stackgl_modules/vendor/gl-axes3d/` and patch that source, never installed files.
Patch webpack's `resolve.alias` for exact `gl-axes3d` imports to this vendor copy,
so imports from both the stack entry point and `gl-plot3d` use it.

Rebuild `stackgl_modules/index.js`, then a minimal distribution containing
`surface` and `scatter3d` (the latter covers points and parametric lines).
Rebuild an unpatched distribution with the same trace set/toolchain for fair
comparison; retain the published gl3d distribution as a separate control.
Retain MIT notices and record hashes, input revisions, patches, sizes and gzip
sizes. No string patching of a minified distribution.

## Files to create

All paths below are relative to `/Users/hwacha/work/personal/learnharness`.

| Path                                                               | Responsibility                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `scripts/plotly-math-fork/sources.lock.json`                       | Source commits, tarball URLs/integrities and source/patch hashes      |
| `scripts/plotly-math-fork/contracts.ts`                            | Prototype-only mesh/config/report TypeScript types and limits         |
| `scripts/plotly-math-fork/build.ts`                                | Fresh checkout, verification, patch application and both builds       |
| `scripts/plotly-math-fork/prepare-mesh.ts`                         | Existing label SVG to validated normalized triangle mesh              |
| `scripts/plotly-math-fork/probe.ts`                                | Offline browser corpus, interactions, raw exports and measurements    |
| `scripts/plotly-math-fork/patches/plotly-prepared-axis-text.patch` | Plotly config and scene bridge, including validation helper           |
| `scripts/plotly-math-fork/patches/gl-axes3d-prepared-titles.patch` | Native title mesh input and invalidation                              |
| `scripts/plotly-math-fork/patches/plotly-stackgl-alias.patch`      | Explicit vendor resolution in webpack                                 |
| `scripts/plotly-math-fork/biome.json`                              | Targeted lint/format for patched dependency JS excluded upstream      |
| `scripts/plotly-math-fork/tsconfig.checkjs.json`                   | `checkJs` for changed dependency JS, with typed dependency boundaries |
| `tests/plotly-math-mesh.test.ts`                                   | Geometry, holes, limits, normalization and errors                     |
| `tests/plotly-math-fork.test.ts`                                   | Build provenance, scene validation and browser harness contracts      |
| `tests/fixtures/visualization/plotly-native-math.json`             | Label/scene corpus and interaction schedule                           |

Keep `scripts/plotly-latex-probe.ts`, its fixtures, tests and saved evidence as the
unchanged annotation comparison. Update the investigation, feasibility, decision
log and handoff with actual prototype findings after execution.

## Proposed internal I/O

These types belong to the experiment, not teacher inputs or persisted product
contracts. Mesh coordinates are em units, x right/y down, ink centered on both
axes. Native rendering supplies the existing y inversion and font-size scaling.
Do not normalize every formula to the same height: preserve its em proportions.

```ts
type AxisName = "xaxis" | "yaxis" | "zaxis";
interface PreparedAxisText {
  schemaVersion: 1;
  source: string; // exact resolved axis title, not a digest alone
  recipe: "mathjax-4.1.3-tex-resvg-256-v1";
  meshHash: string; // SHA-256 of canonical recipe/source/geometry data
  positions: Array<[number, number]>;
  cells: Array<[number, number, number]>;
  bounds: { widthEm: number; heightEm: number };
  accessibleText: string;
}
type PreparedAxisTextMap = Record<
  string, // scene, scene2, ...; reject other keys
  Partial<Record<AxisName, PreparedAxisText>>
>;
```

- `prepareAxisText(source: string, field: string, stackglRoot: string): Promise<PreparedAxisText>`
  consumes trusted installed converter modules from the verified scratch build.
  Reuse `typesetPlotLabel(source, field, 12, 180)` without changing that function.
  Render its path-only SVG with resvg at **256 pixels per em**, with 8 transparent
  pixels of padding on each edge. Contour alpha coverage, not RGB luminance.
- Call pinned `vectorize-text/lib/vtext.js.processPixels` with an x/y ndarray,
  `triangles: true`, centered/middle alignment and size `256`. This helper already
  exists in the release: **no third library fork is proposed**. Its deep import
  stays isolated in this adapter and pinned by integrity.
- Proposed prototype caps: existing 2,048 source characters; raster width 4,096,
  height 2,048; 100,000 vertices; 200,000 triangles; serialized mesh 8 MiB per
  title. Reject oversize content; do not lower quality or truncate silently.
- Validate nonempty finite geometry, finite positive bounds, integer/in-range
  indices, nondegenerate triangles and valid winding before returning. Verify
  SHA-256 again when loading serialized data. Report the provided field path
  for invalid TeX, unsupported glyphs, empty/failed contour or exceeded limits.
- Fork config: optional `preparedAxisText: PreparedAxisTextMap`, default `null`.
  It contains data only. For a supplied axis entry, compare `source` with the
  actual resolved title before use. Reject stale/malformed entries. Missing
  entries retain upstream ordinary-text behavior; the prototype wrapper requires
  an entry for every math title in its fixtures, so missing math cannot pass.
- Prototype math uses the existing regular MathJax TeX font. Color and title size
  use native Plotly settings; other family/weight/style variants are outside this
  experiment, with explicit fixture validation. No HTML/code/callback input.
- Use one mesh per nonempty prepared title per scene, with a figure-local map.
  Repeated requests for the same recipe/source reuse the entry. Replacing source
  replaces its entry; removing a title removes it. No new global mesh cache.
  GPU buffers continue to belong to the axes object and dispose on purge.
  Existing MathJax's bounded glyph cache and upstream ordinary-text cache remain.

## Patch points and execution order

### 1. Reproducible baseline and converter

Create the build/provenance helpers and geometry adapter first. Build the
unpatched custom distribution and verify an ordinary label control before
patching. Record archive integrities and source hashes, including the existing
label helper; fail if the source pins or patch preimages differ.

Geometry tests cover fractions, Greek/subscripts, nested scripts, integrals,
radicals, mixed units/text, `B8O0` holes, a wide formula and multi-line wrapping.
Rasterize resulting triangles against the original alpha mask on the same grid:
require binary-mask intersection-over-union at least `0.98`, separately verify
the reference holes remain unfilled, and save masks/diffs. Test axis orientation
and em scale against a one-em calibration shape. These are proposed acceptance
thresholds, not claims about achieved quality. Failures return to review rather
than silently switching to a different triangulation algorithm.

Test empty/invalid TeX, unsupported glyphs, nonfinite vertices, bad indices,
zero-area triangles, wrong hashes and every limit. The source helper may swallow
triangulation errors and return an empty mesh; the adapter must reject that.

### 2. Native prepared-title path

Apply these source changes in the scratch checkout:

- `src/plot_api/plot_config.js`: declare the optional code-owned config field.
- New `src/plots/gl3d/prepared_text.js`: validate entries and select the scene's
  x/y/z meshes in axis order; throw field-specific errors for mismatches.
- `src/plots/gl3d/scene.js`: attach validated `preparedLabels` to axes options
  before initial GL creation and after each `axesOptions.merge` on update.
  Ordinary `layout/convert.js` title/font behavior remains intact.
- Vendor `gl-axes3d/axes.js`: retain the three prepared entries, detect content
  changes by validated mesh hash, forward them to text creation/update and mark
  text dirty on replacement/removal. Existing camera placement is retained.
- Vendor `gl-axes3d/lib/text.js`: select a supplied mesh for its axis title;
  preserve the existing triangle upload, tick rendering and plain-text path.
- `stackgl_modules/webpack.config.js`: vendor alias described above; rebuild
  `stackgl_modules/index.js` and the selected distribution.

The release's native title alignment includes a string-length heuristic. Retain
it initially and exercise short/long TeX at multiple camera views; the fork does
not automatically solve every label collision. If formula dimensions expose a
placement defect, report it before proposing an additional layout patch.

Test unchanged hash reuse, title replacement/removal, two independent figures,
two scenes in one figure, ordinary text/ticks, `Plotly.react`, resize and purge.
Instrument preparation calls, contour calls and title mesh uploads separately;
camera-only motion must cause zero additional preparation/contour calls. Surface
updates may update GL buffers; they must reuse unchanged prepared geometry.

### 3. Browser proof, export and performance report

Run the same standalone, production-CSP and opaque `allow-scripts` iframe profiles
as the completed probe, with network explicitly disabled and requests recorded.
Embed prepared mesh data and the built Plotly bundle; do not embed browser
MathJax. Retain accessible title text in the document next to the canvas.

Use a saddle surface, a parametric helix and supplied scatter points. Verify the
rendered view matrix changes after real drag/zoom, then reset camera, resize and
update labels. Test title sizes 12/20/32, viewport 900x650 and 450x325, device
pixel ratios 1/2. Export via **raw `Plotly.toImage`**, without SVG overlay cloning,
at live dimensions and at 1,800x1,300. Save PNG and SVG and inspect their rasterized
images for all three colored labels in expected title regions. Nonempty geometry
or absence of console errors alone is insufficient evidence.

For performance, use the same scenes, sampling and 120-step camera sequence for
patched/unpatched custom builds; compare the existing annotation case separately
with its MathJax bundle cost recorded. Warm up once, then record five repetitions
of load/prepare time, animation-frame intervals (median/p95), long tasks, geometry
size and raw/gzip bundle size. Drive 120 deterministic surface/curve updates and
report update completion latency separately from camera frame intervals. Include
one and two mounted figures. Record hardware/Chrome/headless settings. Do not
claim Puppeteer drag duration is FPS or impose an invented product FPS budget.

Gate: all geometry/runtime/export cases pass, zero repeated math preparation
during camera/data updates, no network or unexpected page errors, and resources
are released on purge. Record performance deltas for review rather than calling
an unmeasured advantage a success. Actual Tauri/WebView, browser worker/host
integration and product animation budgets remain later gates.

## Explicit commands after approval

From the LearnHarness root (all output directories must be fresh):

```sh
node --import tsx scripts/plotly-math-fork/build.ts --work-dir /private/tmp/learnharness-plotly-native-math-01
PLOTLY_MATH_BUILD_DIR=/private/tmp/learnharness-plotly-native-math-01 NODE_ENV=test node --import tsx --test tests/plotly-math-mesh.test.ts tests/plotly-math-fork.test.ts tests/plotly-latex-probe.test.ts tests/plot-labels.test.ts
node --import tsx scripts/plotly-math-fork/probe.ts --build-dir /private/tmp/learnharness-plotly-native-math-01 --out data/visualization-review/plotly-native-math-01
npm exec -- prettier --write 'scripts/plotly-math-fork/*.ts' scripts/plotly-math-fork/sources.lock.json scripts/plotly-math-fork/biome.json scripts/plotly-math-fork/tsconfig.checkjs.json tests/plotly-math-mesh.test.ts tests/plotly-math-fork.test.ts tests/fixtures/visualization/plotly-native-math.json
npm exec -- prettier --check 'scripts/plotly-math-fork/*.ts' scripts/plotly-math-fork/sources.lock.json scripts/plotly-math-fork/biome.json scripts/plotly-math-fork/tsconfig.checkjs.json tests/plotly-math-mesh.test.ts tests/plotly-math-fork.test.ts tests/fixtures/visualization/plotly-native-math.json
npm exec -- eslint --no-ignore --fix scripts/plotly-math-fork tests/plotly-math-mesh.test.ts tests/plotly-math-fork.test.ts
npm exec -- eslint --no-ignore scripts/plotly-math-fork tests/plotly-math-mesh.test.ts tests/plotly-math-fork.test.ts
npm run typecheck
git diff --check
```

The build helper executes these commands in its isolated Plotly checkout; the
vendor patch is in place before stack.gl bundling:

```sh
npm ci
npm ci --prefix stackgl_modules
npm run bundle-stackgl --prefix stackgl_modules
npm run preprocess
npm run custom-bundle -- --traces surface,scatter3d --out native-math
```

Run checkout-local Biome `lint --write` and `format --write` over the three
changed Plotly source files with the upstream configuration. Run the same checks
on the two vendor JS files using the proposed targeted configuration, then
re-export the formatted patches and rebuild. Check them without `--write`.
Run checkout `npm run typecheck`; its upstream `checkJs:false` does not check the
changed JS, so additionally run checkout-local `tsc --noEmit -p` on the proposed
`tsconfig.checkjs.json` with explicit absolute include paths to all five patched
JS files and typed/stubbed external boundaries. Generated bundles are verified
by rebuild/hash and browser behavior, rather than blanket reformatting.

Output: fresh `index.html`, `results.json`, per-case HTML/PNG/SVG, geometry masks,
diffs and build manifests. `results.json` records each assertion/failure, source
and asset hashes, measurements and scope not tested; any failed gate makes the
CLI exit nonzero. Repeat a clean build and compare bundle hashes, investigating
any differences before calling the build reproducible.

Tests that consume the scratch build use `PLOTLY_MATH_BUILD_DIR`. When absent in
the ordinary application test suite, explicitly skip those build-dependent
cases with a prerequisite message; keep pure validation/harness tests runnable.
The prototype acceptance commands above require the variable and must fail for
a missing or mismatched build, rather than accepting skipped runtime evidence.

## Approval boundary

Approval authorizes only this isolated prototype with the proposed internal
contract, constants, patches and tests. It does not approve adopting Plotly in
the product, changing 2D rendering, broadening math to custom 3D tick labels,
teacher schemas, UX defaults, or the full visualization plan. After reviewing
evidence, select the backend and finish the product contract/UX plan separately.

## Execution addendum

- The user approved a fourth patch, `plotly-deterministic-css.patch`, after two
  builds differed only in CSS IDs derived from absolute checkout paths. It adds
  `tasks/util/inline_css.js` and changes `esbuild-config.js` to derive the ID from
  the project-relative CSS path. It applies to both control and fork. Two clean
  builds (`/private/tmp/learnharness-plotly-native-math-06` and `-07`) now produce
  byte-identical bundles; both source checkers cover the added files.
- Mesh quality measures all boundary differences in the overlap score. The
  separate hole-fill check tests hole interiors outside the one-pixel contour
  boundary, and reports boundary differences explicitly. A deliberately filled
  hole fails the calibration test. No conversion algorithm or overlap threshold
  was changed.
- Preparation timing excludes test-only coverage masks, flood-fill checks and
  diagnostic PNG generation; those still run for the geometry acceptance corpus.
- The initial full matrix (`plotly-native-math-03`) retained six export failures.
  Investigation reproduced a live camera/layout camera mismatch after wheel
  zoom. The probe now synchronizes the capture camera with `Plotly.relayout` and
  waits for rendering before calling raw `Plotly.toImage`. A fresh full matrix
  (`plotly-native-math-04`) completed with one remaining small-view clipped-title
  failure. The CLI correctly exits 1 and records `passed: false`. No additional
  axis-layout patch was made; see the [proposed follow-up](plotly-native-math-title-bounds-plan.md).
- Internal source checks use explicit external-module boundary declarations
  with `checkJs` on all patched JS; no blanket suppression of changed logic.
  Fresh builds preserve both upstream lockfiles and check patch preimages,
  patch hashes, JS syntax, formatting, lint and types before recording success.
