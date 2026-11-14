# Plotly 3D LaTeX investigation

**Date:** 2026-11-13. **Status:** the user approved and the agent implemented the
[isolated native-math fork prototype](plotly-native-math-prototype-plan.md),
including a separately approved deterministic CSS build fix. The full run
completed: the initial four-patch run passed 109/110 cases. The approved
title-bounds follow-up now passes **110/110 runtime cases and 108/108 camera-sweep
observations**, with its acceptance gate passed. Backend adoption, product
integration and the full visualization implementation plan remain unapproved.

**Title-bounds follow-up:** the user approved the fifth patch, now implemented,
built and verified. It computes a whole-title shift into a two-CSS-pixel inset,
with explicit fit failures for oversized titles. Twenty-five focused tests pass.
Two fresh builds are byte-identical. The full rerun at
`data/visualization-review/plotly-title-bounds-01` exits 0 with no unexpected
page/network errors, all 218 runtime/sweep observations passing, and zero native
math conversions during interaction. All 18 timing configurations completed.
The separate oversized-title check fails inspection with `scene.xaxis.title`
while leaving the render loop error-free. See the
[completed follow-up plan](plotly-native-math-title-bounds-plan.md) for details.
Earlier failed evidence remains preserved. The prior 109/110 result below is the
four-patch baseline, not the final result of the follow-up. The fifth-patch bundle
is 1,733,127 raw / 555,380 gzip bytes; observed surface update medians remain close
to the matching control (11.8ms vs 11.7ms for one figure, 23.6ms vs 23.6ms for two).
Small-view label readability and arbitrary collisions remain product UX topics.

## Native-mesh prototype: execution evidence

The experiment files are in `scripts/plotly-math-fork/`; maintained changes are
four integrity-pinned patches, applied in a separate source checkout. Existing
LearnHarness source, dependencies and the completed 2D pipeline are unchanged.

- Exact sources: Plotly `a929a77b3522887360671c30b270828a04cf4b81`, axes `1.7.1`,
  converter `3.2.2`, MathJax/font `4.1.3`, resvg `2.6.2`.
- Clean builds `-06` and `-07` are byte-identical. The initial difference was
  upstream's CSS plugin hashing the absolute checkout path. The approved build
  patch uses a project-relative path, equally in control and fork. No minified
  bundle is edited. Both release lockfiles remain unchanged.
- Control: 1,725,312 bytes / 552,707 gzip. Native math: 1,729,455 / 554,273.
  Fork increment: **4,143 raw / 1,566 gzip bytes**. The three prepared title
  meshes add **90,356 raw JSON bytes**; no browser MathJax component is embedded.
  These are custom experiment bundles, not final product package sizes.
- Seven label masks achieve **99.05–99.62%** intersection-over-union against
  the original label raster. Glyph holes remain open, including six in `B8O0`.
  The separate hole-interior assertion excludes the one-pixel contour boundary;
  all boundary disagreements remain included in the overlap score and saved
  diff images. A deliberately filled hole fails the calibration test.
- Native drawing uses the prepared triangles and existing camera-dependent title
  placement. Native title buffer counts must match the prepared triangle counts;
  colored image pixels alone cannot let literal-TeX controls pass as fixed math.

### Capture synchronization finding

The first full native run, `plotly-native-math-03`, completed 110 cases with six
small sandbox export failures. Preserve these failures. Investigation in
`plotly-native-math-placement-01`, `-02` and `plotly-native-math-camera-01`
reproduced an offscreen title anchor and then isolated a stale camera state:
after wheel zoom the live camera had advanced while the layout camera used by
raw export lagged behind. In the paired reproduction, synchronizing the camera
with public `Plotly.relayout` and waiting for rendering restored the missing
green title (zero pixels before, 32 after).

The current probe performs that capture synchronization before raw
`Plotly.toImage`; it does not clone SVG annotation layers or implement new axis
layout. It also waits for an actual rendered-view change after both drag and
wheel input. The completed `plotly-native-math-04` rerun has **109/110 passing
cases**, with `passed: false` and CLI exit **1**. The remaining failure is
`app-csp-sandbox-surface-12-450-2`: the green title is absent from the raw PNG
at 450x325, title size 12, device scale 2. A relaxed chroma check also found
zero green pixels. Keep this as a real failure, not a weakened pixel threshold.

All 18 performance configurations finished (five measured repetitions after
warm-up). All native runs recorded zero math conversions. Seventeen focused
tests passed with no skips. Prettier, ESLint, project TypeScript at the prototype
checkpoint, both upstream and focused dependency type checks, and JS syntax
checks passed. At that checkpoint, among the 929 milestone-0 baseline files,
only the handoff document had changed. Subsequent concurrent edits in unrelated
graph/UI/provider files were preserved. The final whole-project typecheck
reported `tests/graph.test.ts(1265,1): '}' expected`; the focused typecheck of the
prototype scripts/tests and their imports passes. The completed 2D plot source
remains unchanged. No unrelated graph/UI/provider fix is included in this work.
At the user's subsequent request, the syntax blocker and stale async calls were
fixed in `tests/graph.test.ts` and `tests/compaction-service.test.ts`. The obsolete
filesystem format-guard assertion now tests backend-error propagation before
source lookup, matching the SQLite/in-memory store migration. All 51 targeted
tests, full-project typecheck, lint and focused formatting checks now pass.

The complete review is `data/visualization-review/plotly-native-math-04/index.html`;
raw assertions are in `results.json`, with a derived `performance-summary.json`.
The archived runner differs from the final checked source only in erased type
annotations; `runner-typecheck-note.json` records identical emitted JavaScript.
The native title-bounds follow-up is [proposed separately](plotly-native-math-title-bounds-plan.md).

### Measurement boundaries

Warm-cache preparation of all three labels takes about **104 ms** in the current
run on an Apple M1 Pro. This includes typesetting, rasterization, contouring,
triangulation and validation. Diagnostic masks/PNGs are measured outside that
path; the earlier 1.4-second sample included those test-only diagnostics.
Camera/data updates require no further math preparation. Ordinary text and tick
buffer updates are counted separately and are not mistaken for new typesetting.

The harness measures five repetitions after a warm-up for surfaces, curves and
scatter, with one/two mounted figures, 120 camera steps and 120 data updates.
Frame intervals are animation-frame observations; update timings are API
completion latency, not a guarantee that every update was painted. Scatter
updates resend supplied points. Performance is exploratory single-machine Chrome
evidence, not a product FPS budget or a Three.js comparison.

Median update API latency across the five repetitions, milliseconds:

| Scene                   | Figures | Unpatched control | Native math | Annotation workaround |
| ----------------------- | ------- | ----------------- | ----------- | --------------------- |
| Surface                 | 1       | 11.8              | 11.8        | 13.5                  |
| Surface                 | 2       | 23.7              | 23.8        | 26.6                  |
| Curve                   | 1       | 3.5               | 3.4         | 3.9                   |
| Curve                   | 2       | 7.4               | 7.2         | 7.2                   |
| Supplied scatter points | 1       | 1.2               | 1.2         | 3.4                   |
| Supplied scatter points | 2       | 2.3               | 2.3         | 6.2                   |

Observed median animation-frame intervals were about 16.7ms in all branches;
these do not establish that every requested camera/data state was painted.
The annotation branch performed 639–714 conversions per single-figure run and
1,350–1,440 per two-figure run. Native math performed zero. Build/source checks
and some diagnostic work ran during the experiment, so this is not an isolated
hardware benchmark or a statistically established speedup.

Native Tauri/WebView, browser-worker mesh preparation/host delivery, product
resource limits, general font variants and custom mathematical tick labels are
not tested. Native 3D SVG exports still contain a rasterized scene. Very small
native title sizes, especially fractions at 12px, need product UX review.

## Completed annotation workaround comparison

Evidence: `data/visualization-review/plotly-latex-2026-11-13-v7/index.html` and
`results.json`. Earlier experiment directories remain unchanged.

| Environment                                       | Live annotations after drag/zoom                         | Raw Plotly export | Composed export                             |
| ------------------------------------------------- | -------------------------------------------------------- | ----------------- | ------------------------------------------- |
| Standalone offline HTML                           | All three math labels present                            | Labels omitted    | Three math groups; 266 magenta label pixels |
| Offline HTML with production app CSP              | All three math labels present                            | Labels omitted    | Three math groups; 269 label pixels         |
| Same CSP, opaque `sandbox="allow-scripts"` iframe | All three math labels present; parent DOM access blocked | Labels omitted    | Three math groups; 268 label pixels         |

All three annotation cases completed with no page/console errors or recorded
external requests; Chrome network access was also explicitly disabled. Three
native-title controls reproduced literal TeX with zero MathJax conversions.
The six probe checks passed; native controls passing means the expected
limitation was reproduced, not that native 3D math titles were fixed.

The fixture is a 33x33 saddle surface with a fraction, Greek letter/subscripts,
units, radical and integral in three demonstration labels. The labels exercise
syntax; their formulas are not claims about the saddle's coordinate units.
Real mouse dragging and wheel zoom changed the rendered view matrix and label
positions. Earlier programmatic-camera captures could lag the requested camera
state; v7 uses actual interaction plus rendered-view revision checks instead.

### Required no-fork wrapper behavior

1. **Offline MathJax configuration:** the combined classic-font component
   initially tried to load an unbundled speech worker. For this isolated
   rendering probe, disable speech/braille/enrichment through `menuOptions`
   settings as well as document options. Give its unused loader roots explicit
   absolute URLs so initialization can resolve paths in opaque `about:srcdoc`.
   The `.invalid` URLs in the probe are never fetched; offline checks enforce
   that. This is not an approved production accessibility policy.
2. **Export composition:** Plotly's unmodified export produced empty mathematical
   annotation groups and PNGs with zero formula-colored pixels. Its export
   redraw starts asynchronous SVG typesetting again before serialization.
   The probe clones the ready live annotation SVG, obtains Plotly's scene SVG,
   replaces the empty annotation groups with those clones, then rasterizes the
   resulting SVG inside the same document. Both SVG and PNG retain the formulas.
   Raw and composed exports are saved separately so the upstream omission stays
   visible in the evidence.

The compositor uses Plotly DOM layer classes and equal live/export dimensions;
keep it version-pinned and regression-tested. A production capture API must
freeze the time/camera and verify geometry/label alignment for the captured
frame, resizing and other export resolutions. The probe is a focused feasibility
test, not that complete maintained capture service.

### Performance and presentation limits

- The extra 20-step drag caused **57-60 MathJax conversion calls** across the
  three annotation cases, versus zero for native controls. These counts confirm
  repeated conversion work. Puppeteer input pacing makes the recorded drag
  duration unsuitable as an FPS comparison.
- Fixed annotation anchors can overlap the surface or numeric ticks after
  rotation; screenshots visibly demonstrate this. Automatic native axis-title
  placement has not been replicated or repaired.
- Locally measured libraries: Plotly gl3d 1,764,130 bytes raw / 562,941 gzip;
  combined MathJax classic-font component 2,290,224 / 813,283. Individual probe
  HTML documents embed both. Do not infer final application bundle size from
  these standalone artifacts.
- Native Tauri/WebView, the actual worker-to-host adapter, animation throughput,
  multi-figure resource budgets, resize and broader label/error corpora remain
  outside this completed probe. No backend is selected by these results.
- Eight focused tests passed; formatter, ESLint with automatic fixes and
  TypeScript passed. Existing source files, package manifests and lockfile were
  preserved against the milestone-0 file hashes; only the existing handoff doc
  differs among those baseline files.

## Finding

The 3D title limitation comes from a separate text-rendering path. Loading
MathJax does not cause native WebGL axis titles to enter Plotly's SVG text
typesetter. There are two credible approaches: use the supported scene-annotation
path, or extend the native text path with prepared mathematical meshes.

The second approach could retain native title placement and avoid mathematical
typesetting during camera movement. Its scope includes Plotly's bundled stack.gl
dependencies, not only the top-level Plotly API. Approach A is now demonstrated
with the compositor and limitations above. B was subsequently implemented and
tested as described in the latest execution evidence.

After reviewing the measured workaround's costs, the user agreed to prototype B
as the preferred direction, then approved its concrete prototype plan. That
experiment is complete; its approved title-bounds follow-up is also complete
and passes the full runtime and camera-sweep checks described above.
Keep A as comparison evidence and a fallback rather than expanding its overlay
machinery into an unreviewed axis-layout implementation.

## Root cause and source evidence

| Source path                                                  | Observed behavior                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plotly `src/plots/gl3d/layout/convert.js`                    | Copies axis title strings into `axesOptions.labels`. No MathJax conversion at this seam.                                                                         |
| `gl-axes3d/lib/text.js`                                      | Converts ordinary strings with `vectorize-text`, caches resulting meshes, and uploads triangle positions to its GL buffer. Native titles/ticks use these meshes. |
| Plotly `src/components/annotations3d/draw.js`                | Projects annotation data coordinates using the camera and delegates to the shared annotation SVG renderer.                                                       |
| Plotly `src/components/annotations/draw.js`                  | Calls `svgTextUtils.convertToTspans`, measures a MathJax group when present, and lays out that group.                                                            |
| Plotly `src/plots/gl3d/scene.js`                             | Calls the annotation draw path from its render method. Annotation redraw during camera motion is a performance risk to measure.                                  |
| Plotly `src/plots/gl3d/index.js` and `src/snapshot/tosvg.js` | Export combines a rasterized 3D scene with SVG layers. This supports an export hypothesis, not a successful export test.                                         |

Sources:
[axis conversion](https://raw.githubusercontent.com/plotly/plotly.js/master/src/plots/gl3d/layout/convert.js),
[native text meshes](https://raw.githubusercontent.com/gl-vis/gl-axes3d/master/lib/text.js),
[3D annotations](https://raw.githubusercontent.com/plotly/plotly.js/master/src/components/annotations3d/draw.js),
[shared annotation renderer](https://raw.githubusercontent.com/plotly/plotly.js/master/src/components/annotations/draw.js),
[scene render](https://raw.githubusercontent.com/plotly/plotly.js/master/src/plots/gl3d/scene.js),
[3D export](https://raw.githubusercontent.com/plotly/plotly.js/master/src/plots/gl3d/index.js),
[SVG export composition](https://raw.githubusercontent.com/plotly/plotly.js/master/src/snapshot/tosvg.js).

These links record the initial main/master investigation. Exact release sources
were subsequently retrieved for the prototype plan: Plotly v4.3.0 peels to
`a929a77b3522887360671c30b270828a04cf4b81`; its stack.gl lock pins
`gl-axes3d@1.7.1`, `gl-plot3d@2.4.7` and `vectorize-text@3.2.2`.
The two text-library tarballs were integrity-checked. The same title/mesh seams
are present in these pinned sources. The open issue is corroborating history,
not a substitute for a release-specific reproduction. A maintainer's 2024 comment describes both
rasterizing mathematical text and moving native labels to SVG as possibilities.
[Upstream issue and maintainer discussion](https://github.com/plotly/plotly.js/issues/608).

## A. Supported scene annotations: first workaround to test

Hide native axis titles and supply arrowless `layout.scene.annotations` with
mathematical text and explicit x/y/z anchors. Plotly's public scene schema
provides anchors, pixel shifts and text angle; its annotation drawing code uses
the MathJax-capable SVG text path.
[Public annotation contract](https://plotly.com/javascript/reference/layout/scene/#scene-annotations).

Benefits: retain Plotly's charting/camera/export infrastructure without modifying
a dependency, and use an existing projected-label mechanism.

Limitations:

- A label at an explicit 3D coordinate is not equivalent to Plotly's native
  camera-dependent choice of a box edge/title location. It can overlap the
  surface or become poorly placed after rotation. It is a label workaround,
  not a complete repair of native axis titles or mathematical tick text.
- Repeated annotation drawing deletes/rebuilds SVG groups and calls the text
  conversion path. Measure both visual stability and typesetting work while
  dragging; do not claim formulas are cached across camera frames.
- Plotly's browser MathJax interface expects a startup/component object. The
  project's current direct MathJax/LiteDOM renderer is not automatically a
  drop-in `window.MathJax`. Bundling/configuration needs a real offline test.
- Full-frame PNG export must wait for mathematical labels. A successful WebGL
  canvas export alone would omit SVG labels.

## B. Native cached-mesh extension: targeted fork candidate

The native renderer already caches triangulated ordinary text. A fork could
allow it to consume prepared math meshes in that same draw path:

1. Reuse `typesetPlotLabel` to validate and typeset mixed text/math.
2. Prepare a normalized triangle mesh before plot creation or a label change.
3. Pass a bounded, code-owned mesh lookup through the 3D axes options.
4. Keep the existing camera-dependent placement, scaling and GL drawing of
   titles. Reuse the prepared mesh during orbit/zoom and surface updates.
5. Invalidate on source/font/format changes, bound caches and dispose resources.
   Nonempty mathematical text that cannot produce a valid mesh must fail with
   its field path, rather than disappearing silently.

Proposed preparation I/O for the experiment, not a teacher-facing contract:

```ts
interface PreparedMathMesh {
  positions: Array<[number, number]>;
  cells: Array<[number, number, number]>;
  bounds: { width: number; height: number };
  sourceHash: string;
}
```

The experimental mesh coordinates would follow the existing native text
renderer's normalization; that normalization and baseline must be established
from the pinned dependency before implementing the adapter. Check finite
coordinates, valid indices, holes, glyph proportions and nonempty geometry.

One practical conversion path is MathJax SVG -> bounded high-resolution pixels
-> the contour/triangulation machinery already used by `vectorize-text`.
The pinned `vectorize-text/lib/vtext.js` already exports an internal
`processPixels` helper. It is not a documented top-level API; the prototype will
isolate its deep import behind an integrity-pinned adapter. This avoids a third
library fork. Raster-to-contour conversion approximates outlines; measure error and
triangle count, especially for fractions, radicals and glyph holes. Direct SVG
outline triangulation is an alternative with more path/transform handling.
[Bundled contour and text implementation](https://raw.githubusercontent.com/plotly/plotly.js/master/stackgl_modules/index.js).

Likely source seams to review on the pinned fork:

- Plotly `src/plot_api/plot_config.js`: declare any code-owned prepared-text
  configuration instead of passing undocumented callbacks or teacher code.
- Plotly `src/plots/gl3d/layout/convert.js` / `src/plots/gl3d/scene.js`: propagate
  prepared meshes into axes options with per-figure ownership.
- `gl-axes3d/axes.js`: forward mesh inputs and invalidate prepared text when
  appropriate.
- `gl-axes3d/lib/text.js`: consume validated prepared meshes while retaining
  ordinary-text behavior and the existing GL draw path.
- Plotly `stackgl_modules/package.json`: pin the patched dependency revision;
  regenerate `stackgl_modules/index.js` and the selected Plotly distribution.

Plotly checks in a bundled stack.gl module and builds it separately. A top-level
npm override of `gl-axes3d` alone would not replace the copy already embedded in
that module. Rebuild it reproducibly; do not patch minified output by string
replacement or rely on edits to an installed `node_modules` tree.
[Dependency/build manifest](https://raw.githubusercontent.com/plotly/plotly.js/master/stackgl_modules/package.json),
[bundled module](https://raw.githubusercontent.com/plotly/plotly.js/master/stackgl_modules/index.js),
[axes update/drawing](https://raw.githubusercontent.com/gl-vis/gl-axes3d/master/axes.js).

Potential benefit: precomputed math geometry can be serialized with the artifact,
so this route need not include a browser MathJax component just to display
unchanging labels. That packaging benefit is a proposal, not a measured result.
Native GL labels remain rasterized in Plotly's usual 3D image export; this is
not a promise of vector text in exported 3D SVG/PDF.

## C. Broader upstream SVG text refactor

Moving every native axis title/tick into SVG would provide sharp vector labels
but requires exposing native placement information, handling camera changes,
layout and export. Upstream maintainers describe this as a substantial refactor.
Evaluate only if A and B cannot meet the requirements; do not infer that being
allowed to fork authorizes this broader scope.

## Initial source-investigation evidence (before probe authorization)

- `NODE_ENV=test node --import tsx --test tests/plot-labels.test.ts`: **six tests
  passed**. Existing label output supports fractions, superscripts, mixed text,
  validation, self-contained paths and native SVG rasterization. This is not a
  Plotly integration test.
- Existing installed browser components were measured without fetching or
  installing anything:
  - `@mathjax/mathjax-tex-font/tex-mml-svg-mathjax-tex.js`: 2,290,224 bytes raw,
    813,283 bytes gzip.
  - `@mathjax/src/bundle/tex-svg.js`: 1,849,625 bytes raw, 616,363 bytes gzip.
  - `@mathjax/src/bundle/tex-svg-nofont.js`: 873,900 bytes raw, 256,003 bytes gzip;
    excludes the font and is not a complete font-independent artifact alone.
- Chrome launch was retried for this investigation and still failed during
  target discovery (`TargetCloseError`) before any test page opened.
- Shell npm-registry access still failed DNS resolution. Plotly is not installed
  locally. Web tools could inspect upstream code but could not retrieve the
  pinned release sources/metadata requested above.
- No Plotly fork, dependency modification, feature source or experimental source
  file was created. No new runtime, export or performance claim is verified.

## Reproducing the isolated experiment

The user subsequently authorized testing the workaround. Created these
LearnHarness-only experiment files; no product renderer or dependency changed:

- `scripts/plotly-latex-probe.ts`: offline CLI consuming an explicitly
  supplied `plotly.js-gl3d-dist-min@4.3.0` package directory; refuses an existing output directory;
  writes self-contained repro HTML, labeled PNGs and numerical/DOM results.
- `tests/plotly-latex-probe.test.ts`: verifies fixture serialization,
  fresh-output protection and missing-asset failure recording. The actual CLI
  browser run checks rendering, camera updates and export.
- `tests/fixtures/visualization/plotly-latex.json`: native-title baseline and
  scene-annotation workaround with initial, rotate and zoom actions.
- No fork was made. Keep any future fork experiment in a separate checkout.

Broader acceptance before product integration still includes nested scripts,
invalid TeX, a curve in addition to the tested saddle, reset/resize and multiple
figures. The completed fixture exercises the initial view, real orbit/zoom and
exports; it does not satisfy that entire corpus. Test label
changes, two simultaneous figures, offline operation and full PNG export.
Record typesetting/cache counts, frame times and triangle counts separately.
Include a corpus of glyph holes and compare mesh coverage against the original
label raster if testing B. Do not claim semantic/visual quality from mere
nonempty DOM nodes or absence of console errors.

Commands (use a fresh output directory):

```sh
NODE_ENV=test node --import tsx --test tests/plotly-latex-probe.test.ts tests/plot-labels.test.ts
node --import tsx scripts/plotly-latex-probe.ts --plotly-dir /private/tmp/lh-plotly-latex-assets-vxZoCz/package --out data/visualization-review/plotly-latex-rerun-01
npm exec -- prettier --write scripts/plotly-latex-probe.ts tests/plotly-latex-probe.test.ts tests/fixtures/visualization/plotly-latex.json
npm exec -- prettier --check scripts/plotly-latex-probe.ts tests/plotly-latex-probe.test.ts tests/fixtures/visualization/plotly-latex.json
npm exec -- eslint --no-ignore --fix scripts/plotly-latex-probe.ts tests/plotly-latex-probe.test.ts
npm exec -- eslint --no-ignore scripts/plotly-latex-probe.ts tests/plotly-latex-probe.test.ts
npm run typecheck
git diff --check
```

The tested no-fork workaround renders and exports math when paired with the
compositor above. Native title placement and per-frame typesetting remain
reasons to consider B if necessary. The completed 2D pipeline is untouched;
product integration and backend selection still need the final plan approval.
