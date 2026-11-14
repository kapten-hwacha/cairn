# 3D plotting inside Tauri: integration plan

**Status (2026-11-14): implemented, verified and packaged.** The user approved
the static 3D increment with “go ahead”. The user wants the usable 3D
feature in the Tauri build. The earlier app build did not contain it. This plan
connects the verified fork to the real `plot` tool, worker and lesson UI.
Animation remains a separate increment. Track implementation and verification
evidence below; do not mistake an intermediate build for the final deliverable.

- [x] Contracts and bounded numerical preparation
- [x] Portable maintained renderer and math labels
- [x] Worker/host verification and deterministic dispatch
- [x] Interactive lesson display
- [x] Native WebView smoke and final app/installer

See [the integration report](plot3d-tauri-integration-report.md) for the 26
native checks, regression results, packaging evidence and implementation findings.

## Outcome and boundaries

The teacher calls the existing deterministic `plot` tool for surfaces, parametric
curves and supplied 3D data points. The learner receives a verified PNG preview
and can activate an interactive figure, orbit/zoom, reset the camera, expand it,
invert its display and download self-contained HTML or the original PNG.

Keep every existing 2D input and SVG result valid, including saved transcripts.
Keep the three teacher artifact tools `plot`, `visual`, `demo`; add no primitive
tools. Reuse the maintained renderer for verification and display. Animation,
2D geometry, visual-agent structured-tool expansion and custom demo controls are
separate increments, not silently bundled into this first 3D build.

## Approved input and result contracts

Create `src/core/contracts/plot3d.ts`; re-export from
`src/core/contracts.ts`, which is already exported through `src/core/index.ts`.
Keep existing `PlotInput` as the unchanged 2D type. Add `PlotToolInput = PlotInput
| Plot3DInput` for admission/dispatch.

```ts
interface Plot3DInput {
  kind: "3d";
  title: string;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  xDomain: [number, number];
  yDomain: [number, number];
  zDomain: [number, number];
  series: Array<
    | {
        kind: "surface";
        label: string;
        expression: string;
        xDomain?: [number, number];
        yDomain?: [number, number];
        sampleAtX?: number[];
        sampleAtY?: number[];
      }
    | {
        kind: "parametric";
        label: string;
        xExpression: string;
        yExpression: string;
        zExpression: string;
        uDomain: [number, number];
        sampleAtU?: number[];
      }
    | {
        kind: "scatter";
        label: string;
        points: Array<{ x: number; y: number; z: number }>;
      }
  >;
}
```

- All 3D axes are linear. Domains must be finite, strictly increasing and have
  finite normalization spans. Surface subdomains lie inside the scene domains.
- Surface expressions allow `x,y`; parametric expressions allow `u`. Reserve
  `t` for the animation increment. Reuse the existing bounded grammar/functions,
  not JavaScript evaluation. Preserve `compilePlotExpression(source)(x)`.
- Propose 1–4 series; at most 10,000 supplied scatter points in total; no implied
  connecting lines. Analytic lines use the parametric branch.
- Reuse the existing 2,048-character expression/label limits and 256 expression
  token limit. Propose title/series-label maximum 160 characters and at most
  16 explicit feature seeds per supplied seed array, within its domain.
- Proposed default view: camera eye `(1.5,1.5,1.2)`, cube aspect, 20px axis
  titles, white background, the tested native axis-title colors, maintained
  series palettes and `plotGlPixelRatio: 1`. No teacher-authored runtime code.

Add a result branch while leaving old `{svg, notes?, image?}` results unchanged:

```ts
interface Plot3DResult {
  format: "interactive";
  title: string;
  html: string;
  preview: { mimeType: "image/png"; dataUrl: string; width: 900; height: 650 };
  runtime: {
    checked: true;
    rendererVersion: string;
    sceneHash: string;
    titleHashes: string[];
    width: 900;
    height: 650;
  };
  notes?: string;
}
```

The HTML is self-contained, as previously approved. This repeats the maintained
library in saved artifacts; shared asset storage is a separate optimization.
Propose maximum HTML 8 MiB and PNG 4 MiB; validate PNG signature/dimensions before
accepting it. A static preview cannot satisfy a failed verification. Existing
job failure/delivery and Markdown-export behavior remain intact.

## Numerical renderer

Create `src/agent/plot3d-sampling.ts` and
`src/agent/plot3d-interval.ts`; test in `tests/plot3d-sampling.test.ts`.

Export `sampleParametricCurve(evaluate, options)` with a shared vector-valued
evaluator and `{segments, evaluations, maxObservedError}` result, and
`sampleAnalyticSurface(evaluate, options)` with `{x, y, z, evaluations,
maxObservedError}` result. Options contain the explicit domains, seeds and
bounded quality policy below. Gap entries in surface `z` are `null`; curve
segments contain finite `{u,x,y,z}` points. Accept AST continuity information
alongside each evaluator; do not treat a callback's finite probes as a proof.

Extend `src/agent/plot-expression.ts` with explicitly scoped AST parsing and
environment evaluation. Keep all existing exports/call signatures working.
Leave the existing 2D `plot-sampling.ts` algorithm unchanged.

Proposed bounded policy:

- Normalize approximation checks by the fixed x/y/z domain spans; target maximum
  **observed** geometric residual `0.001`. This is not a universal pixel or
  analytic error guarantee. Explicit feature seeds cover known narrow features.
- Curves: one shared `u` cache evaluates the whole vector together. Start with
  65 samples plus seeds; use quarter/midpoint chord checks and bounded local
  refinement, at most 16 levels and 16,384 vector evaluations per series.
- Surfaces: nested rectangular grids start at 17x17, refining to at most
  129x129 output vertices. Cache midpoint/edge/interior validation probes,
  bounded by 257x257 (66,049) evaluations per series. Compare against the
  candidate triangles conservatively across both cell diagonals.
- Bound total analytic evaluations at 300,000 and total output vertices at
  70,000. Seeds count toward limits. Reject overflow and indistinguishable
  neighboring parameters. Fail explicitly if observed error remains unresolved.
- Use conservative AST domain checks for division, tan, logarithms, sqrt,
  inverse trig and powers before accepting a segment/cell. Never connect across
  a failed domain check, replace undefined values with zero, or enable
  `connectgaps`. Refine uncertain regions; if continuity cannot be resolved,
  return an actionable field/branch-domain error.
- Observed/proven undefined regions become gaps. Curves split into valid
  segments. For surfaces, mask the affected grid vertices conservatively so no
  triangle bridges that region. If masking would depend on an unproven domain
  assumption, fail rather than fabricate a hole. All-undefined output fails.
- Check trig argument variation as well as residual probes to avoid accepting
  obvious undersampled oscillation. Finite sampling cannot prove the absence of
  arbitrary unseen features; retain that limitation in renderer documentation.

Tests: plane, saddle/paraboloid, helix, coordinate permutations, a feature only
in z, seeded narrow peaks/ridges, reciprocal/tan poles on and between samples,
sqrt/log boundaries, unresolved oscillation, overflow/tiny domains, deterministic
output, seed inclusion, evaluation budgets and no repeated vector evaluation.

## Portable maintained assets and labels

Create `scripts/build-plot3d-vendor.ts` and generated
`src/vendor/plotly-native-math/{plotly-source.json,contour.mjs,manifest.json,LICENSES.txt}`.
Derive them reproducibly from the existing five-patch source lock; preserve the
entire locked contour dependency graph and notices. The ordinary npm ndarray
package is not interchangeable with Plotly's CSP-safe fork of the same version.

`plotly-source.json` contains the library as data for portable worker/Node
loading and HTML embedding. `contour.mjs` is a DOM-free bundle of the locked
`processPixels` and ndarray path. Never import the Node experiment scripts into
the app. Keep native Resvg, `createRequire`, filesystem APIs and Node crypto out
of the browser worker.

Create `src/agent/plot3d-labels.ts` using the existing `typesetPlotLabel` and
prepared-mesh recipe. Extract shared WASM initialization into
`src/worker/resvg-runtime.ts`; use transparent RGBA from Resvg WASM in the
worker and native Resvg in the Node headless adapter. Extend the headless port
with an optional raw-SVG-pixels capability so existing 2D mocks remain valid.
Name this port `rasterizeSvgPixels(svg, {width, height})`, returning
`Promise<{width: number; height: number; rgba: Uint8Array}>`; require transparent
background and exactly `width * height * 4` bytes. Implement both actual adapters.
Use portable SHA-256 and UTF-8 byte measurement; verify actual worker support
under production CSP before accepting the implementation. Retain all measured
mesh caps, hole/coverage checks and the title-bounds patch.

Create `src/agent/plot3d-document.ts`: resolved finite samples + prepared titles
produce the same trusted, self-contained document for capture and live display.
Its data is escaped as data. It uses the maintained fork, no remote scripts,
fonts or model-authored JavaScript. Resize uses `Plotly.Plots.resize`, not a new
plot. Capture synchronizes the live camera before raw `Plotly.toImage`.

## Worker, host verification and delivery

Create `src/agent/plot3d.ts`: validate → sample → prepare labels → build HTML →
verify/render → validate proof/PNG → return `Plot3DResult`.
Export `renderPlot3D(input: Plot3DInput, options?: {signal?: AbortSignal}):
Promise<Plot3DResult>`.

Modify:

- `src/agent/tools/jobs.ts`: extend only the existing `plot` schema/description.
- `src/agent/subagents/runner.ts`: preserve the pre-model-selection plot branch;
  route 2D to `renderPlot`, 3D to the new renderer.
- `src/core/contracts/jobs.ts`: extend result unions and plot failure detection;
  keep saved SVGs and ack/pending/delivery/recovery semantics.
- `src/agent/subagents/headless.ts`, `src/worker/headless-worker.ts`,
  `src/client/worker-client.ts`: add an explicit async 3D verification operation.

Use a typed `lh:render-plot3d` request containing request ID, trusted HTML,
expected renderer/scene/title hashes and a 900x650 viewport. Its opaque sandbox
awaits plot readiness, stable rendering, native mesh/bounds checks and PNG
creation inside the document. Return explicit readiness, hashes, viewport,
preview and error evidence. Match `event.source`, request ID and expected
hashes; reject malformed, stale, failed or oversized responses.
Define the shared request/reply vocabulary and validators in the pure
`src/core/contracts/plot3d.ts`. Expose the optional headless capability as
`verifyPlot3D(request, {signal?}): Promise<Plot3DVerification>`; the renderer
fails explicitly if the adapter lacks it. Existing 2D-only mocks need no change.
The verification record contains the checked renderer/scene/title hashes,
900x650 dimensions, PNG data URL and empty runtime error arrays. Failed checks
throw; an unchecked record cannot become a successful artifact.

Use one shared 30-second verification deadline and guaranteed Plotly purge,
iframe removal and pending-request cleanup on success, failure, abort or timeout.
The Node adapter must await the same async readiness contract. Do not assume
the existing synchronous worker `runDemo` probe can await `Plotly.toImage`.
Keep the existing CSP; blocked loads, context loss or shader failures fail
verification. A successful generic iframe probe is not enough.

Test the existing worker-to-main bridge with the real WASM asset, converter,
HTML, PNG and message validation, including forged source/IDs, abort and timeout.

## Lesson UI

Create `components/artifacts/interactive-plot-card.tsx`; modify
`components/artifacts/steer-card.tsx` to route only the new plot result branch.
Reuse current card controls, download helper, study tracking and persisted
inversion preference. Components consume core exports, not agent modules.

Proposed learner behavior:

- Show the verified preview first, with **Interact**. Allocate WebGL on activation.
  A ready message enables controls; show the preview during loading.
- Keep one stable iframe and memoized `srcDoc`. Expand changes its wrapper to
  fixed positioning inside the measured session area, with an inline placeholder.
  Add an explicit session-area marker in `components/chat.tsx` if needed.
  Do not reparent/remount the iframe. ResizeObserver updates its bounds.
- Preserve camera while expanding/closing; keep it local to the mounted figure.
  Reuse Escape/focus restoration; forward Escape from the sandbox through the
  source-validated bridge.
- Wheel zoom is disabled inline to preserve lesson scrolling, enabled expanded.
  Keep the camera while updating that mode. Reset view restores the initial eye.
- Optional inversion uses the current saved preference; filter the iframe only,
  not an ancestor of its fixed wrapper. Downloads keep original colors.
- Download **HTML** and the initial verified **PNG**. Current-camera PNG export
  is a later feature. Failure/context loss shows a labeled static preview and
  **Retry**; retry recreates this viewer only, with no model call or new job.

Update `src/agent/prompts/teacher/50-demos.md` to say numerical 3D surfaces,
parametric curves and finite data use `plot`; geometry uses `visual`; custom
experiments use `demo`. State the variable/domain rules and no connecting lines
for scatter. Add no new teacher-facing tool.

## Actual Tauri verification and final build

Create `plot3d-smoke.html`, `src/client/plot3d-smoke-main.tsx`,
`src-tauri/tauri.plot3d-smoke.conf.json` and `scripts/plot3d-tauri-smoke.ts`.
Add an explicit smoke Vite mode/output directory in `vite.config.ts` and a
build-gated direct-render request in `src/worker/entry.ts`. The smoke entry
bypasses normal chat/teacher dispatch.

Use a separate app identifier, an incognito smoke window, fresh `CAIRN_USER_DATA_DIR`,
`CAIRN_DATA_DIR` and `CAIRN_AUTH_FILE` paths. No real chat database, credentials or
model calls. A temporary native window exercises the real WKWebView/worker.
Write PNG/base64 evidence and completion JSON through existing `lh_debug_write`;
the outer Node runner waits up to 120 seconds, checks every assertion and exits
only its own child process. Missing/failed evidence is failure.

Require surface, helix and scatter; math titles and bounds; PNG capture;
reload/saved-result rendering; unavailable WebGL; and identical iframe
`contentWindow`, initialization count and camera across expand/close/invert.
The evidence must come from the production renderer, not precomputed demo HTML.

Execute in order: contract/sampling tests; portable vendor/label tests;
renderer/host tests; UI tests; native smoke; final production packaging.
Each stage must pass before claiming its dependent stage complete.

Targeted tests (new files included):

```sh
NODE_ENV=test node --import tsx --test tests/plot3d-contract.test.ts tests/plot3d-sampling.test.ts tests/plot3d-labels.test.ts tests/plot3d-render.test.ts tests/plot3d-worker.test.ts tests/interactive-plot-card.test.tsx tests/plot-tool-schema.test.ts tests/plot.test.ts tests/plot-sampling.test.ts tests/plot-labels.test.ts tests/plot-worker.test.ts tests/jobs.test.ts tests/demos.test.tsx tests/worker-headless.test.ts tests/artifact-ui.test.ts tests/session-markdown.test.ts
plot3d_sources=(
  src/core/contracts/plot3d.ts src/core/contracts.ts src/core/contracts/jobs.ts
  src/agent/plot-expression.ts src/agent/plot3d-sampling.ts
  src/agent/plot3d-interval.ts src/agent/plot3d-labels.ts
  src/agent/plot3d-document.ts src/agent/plot3d.ts src/agent/tools/jobs.ts
  src/agent/subagents/runner.ts src/agent/subagents/headless.ts
  src/worker/resvg-runtime.ts src/worker/headless-worker.ts src/worker/entry.ts
  src/client/worker-client.ts src/client/plot3d-smoke-main.tsx
  components/artifacts/interactive-plot-card.tsx
  components/artifacts/steer-card.tsx components/chat.tsx vite.config.ts
  tests/plot3d-contract.test.ts tests/plot3d-sampling.test.ts
  tests/plot3d-labels.test.ts tests/plot3d-render.test.ts
  tests/plot3d-worker.test.ts tests/interactive-plot-card.test.tsx
)
npm exec -- prettier --write "${plot3d_sources[@]}" scripts/build-plot3d-vendor.ts scripts/plot3d-tauri-smoke.ts plot3d-smoke.html src-tauri/tauri.plot3d-smoke.conf.json src/agent/prompts/teacher/50-demos.md
npm exec -- eslint --fix "${plot3d_sources[@]}"
npm exec -- eslint --no-ignore --fix scripts/build-plot3d-vendor.ts scripts/plot3d-tauri-smoke.ts
npm run typecheck
npm run vite:build
node node_modules/@tauri-apps/cli/tauri.js build --config src-tauri/tauri.plot3d-smoke.conf.json --no-bundle --ci
node --import tsx scripts/plot3d-tauri-smoke.ts --binary src-tauri/target/release/cairn --out /private/tmp/cairn-plot3d-tauri-smoke-01
npm run desktop:dist
hdiutil verify src-tauri/target/release/bundle/dmg/Cairn_0.5.0_aarch64.dmg
git diff --check
```

The explicit formatter/linter lists cover planned implementation paths; add any
existing regression test actually modified. Do not format untouched existing
files. Generated assets retain byte-identical hash/rebuild checks instead of
rewriting upstream source with the app formatter; typecheck their exported
interface through generated `src/vendor/plotly-native-math/contour.d.mts`.
Protect the earlier 2D/visual-agent/worker regressions. Preserve dirty work and
all prototype evidence; no commit, installation over `/Applications`, or release
publication is included. Deliver the newly built `.app` and `.dmg` only after
the integrated native smoke gate passes.
