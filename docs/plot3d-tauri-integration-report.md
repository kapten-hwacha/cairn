# Static 3D plotting in Tauri

The approved static 3D increment is integrated. The existing `plot` teacher tool
now accepts surfaces in x/y, parametric curves in u and finite supplied scatter
points through `kind:"3d"`. Existing 2D inputs, SVG figures and deterministic
pre-model dispatch remain supported. No new teacher tool was introduced.

The learner gets a verified PNG, then Interact, Reset view, Expand, inversion and
original PNG/self-contained HTML downloads. The same iframe and camera survive
expansion and inversion. Animation and the remaining geometry/visual-agent
expansion are separate increments.

## Implementation

- `src/core/contracts/plot3d.ts`: compatible input/result branch, fixed domains,
  bounded payloads, runtime provenance and PNG validation.
- `src/agent/plot-expression.ts`, `plot3d-interval.ts`, `plot3d-sampling.ts`:
  scoped bounded expression evaluation, shared vector sampling, surface
  refinement, conservative domain guards and explicit unresolved errors.
- `src/agent/plot3d-labels.ts`, `src/worker/resvg-runtime.ts`: offline MathJax
  paths, transparent native/WASM rasterization, maintained contour conversion,
  positive mesh winding, SHA-256 and coverage/hole validation.
- `src/agent/plot3d.ts`, `plot3d-document.ts`, `plot3d-scripts.ts`,
  `plot3d-runtime.ts`: one maintained document for verification and display,
  fixed axes, native math titles, colored mathematical legend and raw PNG export.
- `src/agent/tools/jobs.ts`: provider-facing object properties for both input
  branches, followed by Pi validation of the selected complete branch before
  dispatch. This avoids Anthropic dropping a root-only union. Strict-provider
  support is not enabled or claimed; existing nested unions are retained.
- `src/agent/subagents/runner.ts`, `headless.ts`,
  `src/worker/headless-worker.ts`, `plot3d-verify.ts`,
  `src/client/plot3d-host.ts`, `worker-client.ts`: explicit asynchronous runtime
  verification with source/request/proof checks, one 30-second deadline policy,
  cancellation and resource cleanup. Plot jobs still bypass model selection.
- `components/artifacts/interactive-plot-card.tsx`, `steer-card.tsx`,
  `components/chat.tsx`: preview-first display, local camera, stable iframe,
  session-bounded expansion, Escape/focus restoration and persisted inversion.

The pinned five-patch Plotly bundle is unchanged:
`f98d655a082b44857e6349aadeb91e385909866477da8c3206a78471e854497e`.
The portable contour bundle is
`b41daeeb5aa9ddf639ad174fc01ba9b1bc08f617d94d86f85ddadf9ab22b6662`.
Both verified clean checkouts regenerate identical vendor outputs. Generated
notices cover the runtime dependency closures and are included in packaged
assets and downloaded HTML.

## Native issues resolved

Tauri adds script hashes to its CSP. Inline scripts inside generated figures
therefore need matching authorization. Vite now emits the exact trusted library
and runtime script bytes as assets, allowing Tauri's existing hash mechanism to
authorize them. No `unsafe-eval` or disabled CSP modification was added.

WKWebView pauses animation frames in a fully occluded verification iframe. The
verification host now keeps its nearly transparent, noninteractive frame in the
viewport above the page until capture completes, then removes it. Readiness
still requires actual rendering, title/bounds inspection and decoded PNG export.

The radical/subscript coverage regression was an inverse-coordinate calibration
error in the prototype's coverage comparison. The converter now exposes its
actual normalization origin as transient diagnostics. Coverage uses that origin
and pixel-center alignment; persisted geometry, mesh hashes, the 0.98 IoU
threshold and the zero-filled-hole guard remain unchanged.

## Evidence

Saved under `data/visualization-review/plot3d-tauri-integration-01/`:

- `report.json`: **26/26 actual WKWebView checks**, with surface, helix, scatter
  and mixed four-series PNGs. This exercises real worker WASM/contours,
  production CSP, opaque sandbox, title hashes/bounds and PNG capture. It also
  checks preview allocation, wheel defaults, stable iframe/camera, focus,
  Escape, reset, saved-result restoration and WebGL failure/Retry behavior.
- `tests.log`: **184/184** focused and existing regression tests passed.
- `schema-dispatch-tests.log`: **68/68** passed after the provider-schema repair,
  covering real Pi argument validation, invalid-branch rejection before job
  creation, deterministic 3D delivery without selecting a model, and existing
  demo/visual/plot behavior.
- `typecheck.log`: full-project TypeScript check passed.
- `lint.log`: no errors; six existing hook-dependency warnings in
  `components/chat.tsx`, whose implementation changed only by a scope marker.
- `native-build.log`: isolated release smoke build.

Modified source was formatted and linted with automatic fixes. The trusted
runtime string was separately formatted, linted and syntax-checked as JavaScript,
then executed in WKWebView. Generated assets use byte-identical rebuild checks.
No model or external provider call was needed for these checks.

The smoke uses a separate app identifier and fresh `CAIRN_USER_DATA_DIR`,
`CAIRN_DATA_DIR`, `CAIRN_AUTH_FILE` paths. It does not mount normal chat or use the
learner's data/credentials. Its runner terminates only its own child process.

## Rebuild

```sh
# Optional: regenerate the maintained source build in a fresh directory.
node --import tsx scripts/plotly-math-fork/build.ts --work-dir /private/tmp/lh-plotly-fresh
node --import tsx scripts/build-plot3d-vendor.ts --build-dir /private/tmp/lh-plotly-fresh
node --import tsx scripts/build-plot3d-vendor.ts --build-dir /private/tmp/lh-plotly-fresh --check

node node_modules/@tauri-apps/cli/tauri.js build --config src-tauri/tauri.plot3d-smoke.conf.json --no-bundle --ci
node --import tsx scripts/plot3d-tauri-smoke.ts --binary src-tauri/target/release/cairn --out /private/tmp/lh-plot3d-smoke
npm run desktop:dist
hdiutil verify src-tauri/target/release/bundle/dmg/Cairn_0.5.0_aarch64.dmg
```

The final normal build must follow the smoke build because both use the same
Cargo executable target. The production build contains the renderer and trusted
script assets; the smoke entry and synthetic WebGL-failure asset are excluded.

## Delivered build

`npm run desktop:dist` completed successfully. Outputs:

- `src-tauri/target/release/bundle/macos/Cairn.app` — ARM64, 26.93 MiB.
- `src-tauri/target/release/bundle/dmg/Cairn_0.5.0_aarch64.dmg` — 17.22 MiB;
  `hdiutil verify` reports a valid checksum (`CRC32 564365A7`).

The packaged identifier is `com.hwacha.cairn`. Both trusted rendering
script assets match the native-tested build byte-for-byte, and their CSP hashes
are present in the packaged executable. The smoke command/entry and synthetic
WebGL-failure asset are absent from production assets. Exact asset, executable
and installer SHA-256 hashes are saved in `build-provenance.json`; the installer
SHA-256 is `6165b28d421af4b3a163c10b77de0cdde9f066a56e8ca9d58be7c7a0ca591f7b`.

Sampling bounds describe observed approximation quality, not a global analytic
proof that every unseen feature is absent. Explicit seeds cover known narrow
features; unresolved continuity/quality fails instead of fabricating geometry.
Axis-title viewport containment is checked; a general label-collision solver is
outside this increment. No commit, installation over `/Applications`, or release
publication is included.
