# Renderer feasibility: milestone-0 investigation

**Updated:** 2026-11-13. **Status:** source investigation, baseline measurements
and an isolated no-fork Plotly LaTeX probe completed. Backend not selected;
project dependencies and product renderer remain unchanged. This is not the
completed full feasibility gate from the [handoff](deterministic-visualization-handoff.md).

**2026-11-13 follow-up:** the user requested investigating a Plotly LaTeX fix and
is open to a fork if necessary. The [focused investigation](plotly-latex-investigation.md)
identifies an existing SVG scene-annotation workaround and a native cached-mesh
extension candidate, including the prebuilt stack.gl rebuild requirement.
The user then authorized an isolated probe. The annotation workaround now has
real Chrome evidence: offline drag/zoom and composed SVG/PNG exports pass with
production CSP and an opaque sandbox. Raw Plotly export omits the formulas;
the no-fork compositor is required. Placement and repeated typesetting remain
limitations. See the focused investigation's latest measured result; backend
remains open and native WebView/worker-host integration remains unverified.

**Agreed next direction after the measured workaround:** evaluate a targeted
native cached-math-mesh fork next. The user agreed with this direction; the
[concrete isolated prototype plan](plotly-native-math-prototype-plan.md) was
approved and implemented, including the separately approved deterministic CSS
build fix. The full runtime run finished with 109/110 cases passing; its
initial acceptance gate failed due to one small sandbox title-clipping case.
The approved fifth-patch title-bounds fix now passes 110/110 runtime cases and
108/108 camera-sweep observations; the isolated prototype gate is passed. Read the
[latest execution evidence](plotly-latex-investigation.md). It retains native title placement,
avoid repeated typesetting for unchanged text, and include mathematical glyphs
in the existing GL export path. These are hypotheses for that prototype, not
completed fork results. Do not undertake the broader native-SVG-text refactor
or product integration without the concrete plan approval.

## Candidates and verified upstream facts

| Candidate                             | Useful maintained behavior                                                                | Work and risks for this project                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plotly.js 4.3.0, `gl3d` distribution  | Plot axes, surfaces, 3D scatter/lines, camera controls and image-export machinery         | 3D math-axis text needs a specific proof; check actual CSP compatibility and complete exports. Consider the larger strict distribution if necessary. |
| Three.js 0.187.0 plus `OrbitControls` | WebGL rendering, indexed meshes, points, line segments, camera controls and disposal APIs | Application owns plot axes, ticks, clipping/gap topology, math-label placement, accessibility and full-frame composition. Requires WebGL 2.          |

Three.js's npm `latest` metadata reports version **0.187.0**, MIT, upstream
git head `7e89746a687bb88271253698fa108b1dd59825d0`; this is registry
verification, not a local installation. Its package has separate module and
addon exports. [Registry metadata](https://registry.npmjs.org/three/latest),
[package source](https://raw.githubusercontent.com/mrdoob/three.js/master/package.json).

Plotly's current upstream distribution README advertises **4.3.0** and reports
`gl3d` at **1.76 MB minified / 566 kB gzip**, versus the strict distribution at
**5.19 MB minified / 1.59 MB gzip**. These are publisher figures, not locally
measured artifacts. The `gl3d` package's registry metadata could not be retrieved
through the web tool, so the published npm version still needs confirmation
before choosing an exact dependency pin.
[Distribution information](https://raw.githubusercontent.com/plotly/plotly.js/master/dist/README.md).

Both projects use MIT licenses. Retain notices in any embedded distribution;
audit the selected bundled dependency notices too.
[Three.js license](https://raw.githubusercontent.com/mrdoob/three.js/master/LICENSE),
[Plotly license](https://raw.githubusercontent.com/plotly/plotly.js/master/LICENSE).

## Findings that affect selection

### Math labels are an explicit acceptance gate

Plotly documents MathJax support, loaded separately. Its 3D axis conversion
passes axis-title strings into a GL axes structure; this does not establish
support for the existing measured MathJax SVG-path labels. The upstream issue
specifically about LaTeX in 3D axis titles remains listed in the backlog.
Treat this as a concrete risk to verify on the exact candidate version, rather
than inferring failure or success from general LaTeX documentation.
[LaTeX documentation](https://plotly.com/javascript/LaTeX/),
[3D axis conversion](https://raw.githubusercontent.com/plotly/plotly.js/master/src/plots/gl3d/layout/convert.js),
[3D axis-title issue](https://github.com/plotly/plotly.js/issues/608).

With Three.js, pre-typeset the project's existing path labels, project their
anchors with the same camera as the geometry, and compose the geometry canvas
and label layer into the exported frame. This is a proposed adapter design,
not implemented capability. Capturing only the WebGL canvas would omit any DOM
label overlay. Prove that the same export works inside the worker's opaque-origin
sandbox iframe, where a parent screenshot is not the export mechanism.

### CSP is part of portability

`src-tauri/tauri.conf.json` permits inline scripts and WASM compilation, but not
general JavaScript string evaluation. Plotly's upstream documentation describes
runtime code generation in regl and a strict build with pre-generated code.
Its 3D renderer also uses a separate GL stack, so passing one strict-build test
or searching for one token cannot establish that every 3D trace works under CSP.
Exercise the selected surface/curve/scatter runtime with the app's CSP in place.
[Build documentation](https://github.com/plotly/plotly.js/blob/main/CONTRIBUTING.md),
[3D scene source](https://raw.githubusercontent.com/plotly/plotly.js/master/src/plots/gl3d/scene.js).

### Graphics support and failure reporting

Three.js's WebGL renderer requires WebGL 2; WebGL 1 support was removed at r163.
Its standard OrbitControls supplies rotation, zoom and pan, while the app must
provide keyboard-accessible controls appropriate to the approved UX.
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer),
[OrbitControls](https://threejs.org/docs/pages/OrbitControls).

Plotly can install a no-WebGL placeholder rather than rejecting initial plot
creation. Therefore a fulfilled library promise alone is insufficient runtime
evidence. Detect graphics creation/context-loss failures and verify the intended
scene and exported frame before recording success.
[3D initialization source](https://raw.githubusercontent.com/plotly/plotly.js/master/src/plots/gl3d/scene.js).

## Initial baseline measurements (before the authorized Plotly probe)

- Existing plot/agent/delivery baseline: 224 tests passed, zero failed.
- Existing worker adapter tests: six passed.
- The real browser-worker test built a 4,203,628-byte isolated unminified plot
  worker and a 1,142,839-byte Vega-only comparison; increment 3,060,789 bytes.
- That test failed at Chrome target discovery (`TargetCloseError`) before
  offline/browser/renderer assertions. A startup-only check reproduced it.
- TypeScript passed. No native Tauri/WebView test was performed.
- Read-only shell access to the npm registry failed DNS resolution. Web browsing
  could retrieve upstream docs and Three.js metadata. Do not report dependency
  fetching, installation or candidate bundling as successful.

Logs and preservation snapshot are recorded in the
[draft plan](deterministic-visualization-plan.md#fresh-baseline-evidence).

## Proposed portable build seam for review

Proposed files, subject to final plan approval:

- `scripts/build-visualization-runtime.ts`: bundle browser runtime entrypoints
  at build time using the existing Vite toolchain. Emit IIFE source with no
  runtime external imports, preserve license text, and record byte counts/hash.
- `src/agent/visualization/generated/runtime-bundle.ts`: generated module
  exporting escaped runtime source strings and a version/hash manifest. Node
  imports this ordinary TypeScript module; Vite can bundle the same module in
  the worker. No `?raw`, filesystem reads or CDN requests at artifact generation
  or artifact playback time. The final plan must settle generated-file policy
  and build/test lifecycle before this path is adopted.
- `src/agent/visualization/render.ts`: load the interactive bundle lazily only
  for an interactive job; serialize bounded validated specification/label data
  into maintained HTML; inject inspection rather than importing a global browser.
- `src/agent/subagents/headless.ts`, `src/worker/headless-worker.ts` and
  `src/client/worker-client.ts`: Node and worker-host adapters implement the same
  readiness, time-seek and full-frame-export contract. The worker host owns the
  sandbox iframe, message-source checks, timeout, abort and disposal.

This describes how portability could be achieved. A generated string module's
existence alone would not prove it: tests must generate an HTML artifact through
both Node and a real bundled worker, copy it independently, block network access,
apply the app CSP, and export frames including axes and math labels.

## Original broader backend experiment proposal

The user authorized the narrower LaTeX workaround probe, now completed above.
This broader backend comparison still needs its concrete scope agreed before
adding candidate packages or experiment code. Keep project dependencies and
product code unchanged. Use a temporary directory, exact version pins,
the existing project's Vite/Puppeteer/MathJax modules, and produce reproducible
raw/gzip size, readiness/capture/update timings and portable HTML evidence.

Use a paraboloid, saddle, helix, supplied scatter points and a surface with an
explicit invalid region. Test depth ordering, gap topology, axis orientation,
math labels, orbit/zoom/reset, resize, full-frame export and context failure.
Use both Node browser execution and the real worker-to-host sandbox route.
Preflight Chrome before installing anything: current startup failure prevents
the required runtime evidence even if packages can be obtained.

Initial source-review recommendation, since qualified by the measured probe: **Three.js for
3D**, preserving the existing 2D SVG pipeline. Its geometry/camera primitives let
the maintained adapter own surface gaps and reuse the project's MathJax path
labels without depending on a chart library's 3D text handling. The tradeoff is
maintaining plot axes/ticks and projected label/full-frame composition. These
adapter properties are proposed implementation choices, not proven capability.

The recommendation does not approve a dependency or replace the missing runtime
measurements. Keep backend selection pending the user's decision and the
feasibility gate; native WebView behavior remains explicitly unverified until
exercised. Plotly remains a fallback candidate if the measured Three.js adapter
cannot meet the accepted requirements.

## Recommendation rationale discussed on 2026-11-13

The user requested an explanation before selecting Three.js; the backend remains
unapproved. The recommendation is for a focused, code-owned mathematical plot
adapter above Three.js, not a replacement of the completed static 2D renderer.

- **Separate numeric authority from drawing:** safe expression evaluation,
  sampling, reference validation and time evaluation remain in maintained
  application code. Three.js consumes resolved positions and triangle/line
  topology. It does not validate equations, prove sampling accuracy or make GPU
  output pixel-identical across devices.
- **Keep the existing label contract:** the adapter can reuse the project's
  measured MathJax paths and own their placement/export. This requires writing
  and testing a label adapter; Three.js itself does not typeset TeX. Plotly's
  unresolved 3D math-axis issue makes that specific feature a candidate risk,
  without proving the current release fails every possible label approach.
- **Own gaps explicitly:** indexed geometry permits omitting triangles and line
  segments across identified invalid regions. Detection still depends on the
  sampler and declared domains; arbitrary discontinuities cannot be discovered
  reliably by a finite sample set.
- **Reuse maintained interaction:** OrbitControls provides orbit/zoom/pan. The
  project owns its time model and keyboard controls; every seek supplies the
  new scene to the renderer, preserving the approved time semantics.

The main cost is maintaining axes, tick placement, label collisions, responsive
layout, accessibility and full-frame capture. If that work exceeds a small
focused adapter, reconsider the recommendation before building a general chart
library. There is no measured size or performance advantage yet, and modern
Three.js requires WebGL 2.

Sources: [geometry API](https://threejs.org/docs/pages/BufferGeometry),
[camera interaction](https://threejs.org/docs/pages/OrbitControls),
[renderer requirements](https://threejs.org/docs/pages/WebGLRenderer),
[Plotly 3D math-axis issue](https://github.com/plotly/plotly.js/issues/608).

## Latest comparison position and performance question

No backend has been selected. In the follow-up discussion the earlier Three.js
recommendation was explicitly qualified: an open upstream math-label issue is
not enough to reject Plotly without reproducing the problem. Test Plotly's 3D
labels, complete offline exports and app compatibility first; its existing chart
features could make it the more practical choice. Three.js remains the candidate
when the needed control or measured performance justifies its adapter cost.

Performance is unmeasured for both candidates in this project. A carefully built
Three.js adapter is expected to offer more control over per-frame work because
it can reuse geometry buffers and update attributes directly. That is an
engineering expectation, not evidence of a faster complete labeled plot.
Plotly provides `react`/`restyle` updates that avoid destroying/recreating a plot;
its animation docs also describe redraw overhead and transition limitations.
Those limitations do not establish that 3D animation is impossible or too slow.
[Plotly update APIs](https://plotly.com/javascript/plotlyjs-function-reference/),
[animation behavior](https://plotly.com/javascript/animations/),
[Three.js geometry buffers](https://threejs.org/docs/pages/BufferGeometry).

Compare separate workloads: cold load/readiness, camera-only orbit/zoom, time
scrubbing and continuous surface deformation, and several mounted figures.
Use the same sampled data, domains, viewport/pixel density and required labels;
measure expression/sampling time separately from backend updates and full-frame
export. Candidate surface sizes such as 64x64 and 128x128 are benchmark inputs,
not approved product limits. Measure frame-time distribution, scrub-to-display
latency, dropped frames, ready time, artifact bytes and memory/context behavior.
Do not claim a frame-rate, size or native-WebView advantage before those checks.
