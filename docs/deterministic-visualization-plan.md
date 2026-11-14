# Deterministic visualization implementation plan

**Status:** milestone 0 in progress; feature implementation is not authorized.
**Source:** [handoff](deterministic-visualization-handoff.md).
**Repository:** `/Users/hwacha/work/personal/cairn`.

This document records decisions made during the resumed milestone-0 discussion.
Approval of a direction does not approve every field name, implementation detail
or limit below. The completed plan needs a separate final approval before coding.

## Confirmed decisions

| Decision                                                                                                                                                                                       | Status                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Three teacher artifact tools: `plot`, `visual`, `demo`                                                                                                                                         | Previously approved; preserve other teacher tools |
| Direct numerical plots bypass model selection; structured drawing stays inside the visual agent                                                                                                | Previously approved                               |
| Initial scope: 2D constructions/number lines, 3D surfaces/parametric curves, time-dependent plots/geometry, **including 3D scatter/data points**                                               | Approved in resumed discussion                    |
| Defer implicit surfaces, volumes, arbitrary meshes, chemistry layout and numerical physics solvers                                                                                             | Approved as part of initial scope                 |
| Keep all existing 2D inputs; add discriminated `kind: "3d"` inputs, explicit linear 3D axis domains, surfaces in `x,y`, curves in `u`, optional `t` for time                                   | Direction approved                                |
| Scatter consists of supplied finite `{x,y,z}` points with no connecting lines; animated 2D requires fixed y-domains                                                                            | Direction approved                                |
| Preserve saved SVG results; add self-contained interactive HTML with PNG preview and successful runtime checks                                                                                 | Direction approved                                |
| Visual agent receives initial frame or start/middle/end frames after every revision; direct plot has automated checks without a model inspection pass                                          | Direction approved                                |
| Start paused; play once; explicit time domain and playback duration; fixed axes; pause when hidden; keyboard scrubbing; local mounted camera/time state                                        | Approved                                          |
| Restart resets time; separate Reset view resets camera; 1,000 slider intervals; no automatic motion under reduced-motion preferences                                                           | Approved                                          |
| Geometry: named points/midpoints, segments/vectors/circles/polygons, referenced computed lengths/angles, default visible point markers, external circle labels, equal scale, overflow callouts | Direction approved                                |
| Invalid constructions produce field-specific errors; right-angle marker requires normalized dot-product magnitude at most `1e-10`; no general constraint solver                                | Direction approved                                |

Additional approvals from the follow-up discussion:

- **Demo reuse:** whole-document reuse first. The demo builder can produce a
  complete maintained visualization; embedding a structured figure driven by
  custom HTML controls is deferred. Existing custom-demo authoring remains.
- **Failure direction:** field-specific invalid-input errors, gaps for undefined
  plot regions, and actionable failure when bounded sampling cannot resolve the
  requested content. Unsupported-device presentation still needs a choice.
- **Resource policy:** bounded refinement and explicit limits, with exact values
  proposed after measurement. Agreement is not approval of numerical constants
  or of a particular animation-invalidity policy.
- **Visual-agent tools/transition:** proceed with the proposed `draw_geometry`,
  `draw_plot`, `inspect_visual` direction; reject `edit_svg` on a structured
  artifact; `write_svg` explicitly replaces it with raw output and drops the
  structured claims. All replacements invalidate inspection.
- **Final specification:** draft the exact contracts, build paths and prompt
  wording for review. Final implementation-plan approval is still required.
- **Fork direction:** after reviewing measured annotation-workaround costs,
  the user agreed to prefer a targeted native text fork prototype. The
  [concrete prototype plan](plotly-native-math-prototype-plan.md) was approved
  with “go ahead” and completed; its initial run passed 109/110 cases. The user
  then approved and the agent completed the title-bounds follow-up: 110/110
  runtime cases and 108/108 camera-sweep observations now pass. The isolated
  prototype acceptance gate is passed.
  A fourth, build-only CSS determinism patch was separately approved.
  This does not select the product backend or
  approve a broad renderer refactor. See the
  [LaTeX investigation](plotly-latex-investigation.md) for comparison evidence.

## Current-tree audit and preservation

Initial status had 24 modified tracked paths and 33 untracked status entries
(some entries are directories). No staged changes were listed. The tracked diff
contained 1,104 insertions and 59 deletions, including formatting changes already
present before this task. Untracked plot source/tests/fixtures are completed work,
not disposable experiment files.

- Preserve `src/agent/plot.ts`, `plot-expression.ts`, `plot-sampling.ts`,
  `plot-annotations.ts`, `plot-labels.ts`, `plot-math-format.ts`, `plot-layout.ts`,
  their tests/fixtures and saved reviews. Keep `renderPlot(input): Promise<string>`.
- Existing dirty job/core/UI changes register and deliver `plot`; the runner's
  plot branch occurs before model selection. Keep its dispatch/delivery behavior.
- Existing dirty visual-agent tests and code require an image to reach a later
  model call, including at the iteration limit. Do not regress that gate.
- Existing dirty Buffer imports/shims and Vite alias fix browser-worker image
  processing. Preserve them and their tests.
- `src/agent/tools/jobs.ts` also contains PDF admission code and existing
  formatting changes. Do not rewrite unrelated sections while evolving plots.
- Existing API inversion, pending/activity and artifact-registry changes are
  part of the working baseline. No reset, commit, cleanup or bulk formatting.

A read-only preservation snapshot was saved at
`/private/tmp/cairn-milestone0-8JxMp6/`: `status.txt`, `tracked.diff`, and
SHA-256 hashes of 929 tracked/unignored files. This is local audit evidence, not
a repository backup or a reason to discard concurrent user changes.

## Fresh baseline evidence

- Scoped regression command from handoff section 8: **224 passed, 0 failed**
  across 26 suites; 21.8 seconds. Log:
  `/private/tmp/cairn-milestone0-baseline.log`.
- Worker command from handoff section 8: **6 passed, 1 failed**. Worker WASM,
  Buffer, SVG/PDF and bridge-string tests passed. The real Chrome worker test
  failed during Puppeteer target discovery with `TargetCloseError`, before
  renderer/browser assertions. A separate startup-only diagnostic reproduced
  the same error. Cause is not established; do not label it a renderer failure
  or claim browser verification passed. Logs:
  `/private/tmp/cairn-milestone0-worker-baseline.log` and
  `/private/tmp/cairn-milestone0-chrome-diagnostic.log`.
- The failed browser test completed its isolated bundle builds first:
  renderer worker 4,203,628 bytes; Vega-only comparison 1,142,839 bytes;
  math/layout increment 3,060,789 bytes. These are unminified isolated bundles,
  not production artifact sizes.
- `npm run typecheck`: passed. Log:
  `/private/tmp/cairn-milestone0-typecheck.log`.
- `git diff --check`: passed before document changes.
- No live model calls, dependency changes, feature code, commits or publishing.

## Newly identified integration requirements

1. `src/client/worker-client.ts` owns the actual hidden sandbox iframe for worker
   HTML verification. Updating `src/worker/headless-worker.ts` alone cannot
   capture frames. Add this exact host path and its real-browser tests to the
   interactive milestone. The new bridge must check `event.source` against the
   specific iframe window in addition to a request ID, and remove listeners,
   timers and frames on success, timeout, cancellation and host teardown.
2. The existing worker adapter has a no-host fallback that returns demo success.
   The new visualization inspection must fail when no execution host exists;
   it cannot use that fallback as runtime evidence.
3. Tauri's production CSP allows inline script and WASM compilation but does not
   grant general string-to-JavaScript evaluation. Backend feasibility must
   exercise the actual CSP as well as `sandbox="allow-scripts"`. A WebGL backend
   that needs `new Function` is not acceptable without a separately reviewed
   resolution; do not weaken the app CSP as an incidental implementation choice.
4. `next.config.ts` already handles standalone trace gaps. Prefer an importable
   generated runtime-string module shared by Node and Vite, avoiding a new
   Node-only filesystem/runtime-loader path. Prove standalone availability when
   this seam is implemented.

## Decisions still requiring discussion

- Figure inversion/fullscreen, unsupported-device presentation and retry policy
  (learner-facing explanation and concrete proposal below).
- Backend selection after measured portability/label/export/CSP checks; any
  experimental dependency or probe-file addition requires prior authorization.
- Exact sampling/resource budgets, discontinuity/time-error policies, geometry
  annotation fields/tolerances, service dependency signatures and build paths.
- Exact teacher/visual/demo prompt changes and final implementation plan.

### Backend recommendation, not yet selected

Recommend **Three.js for the 3D branch**, with existing Vega/static SVG plotting
and MathJax label code preserved. The application would own a maintained plot
adapter using Three.js geometry/camera APIs and the existing measured glyph
paths. This offers direct control over the math-label/export contract and mesh
gaps, at the cost of maintaining axes/ticks and label projection/composition.
Plotly supplies more chart behavior but still needs specific proof of 3D
math-label and CSP compatibility. This is an engineering recommendation based
on source review, not a claim that the runtime feasibility gate has passed.
Selection and dependency changes remain unapproved.

The subsequent discussion qualified this recommendation: test Plotly's 3D math
labels, export and app compatibility before rejecting it. If it meets the
requirements, its maintained chart features may make it the more practical
choice. Three.js offers more direct control over per-frame work, but no complete
renderer performance comparison has been run. Include load, camera-only motion,
surface deformation/scrubbing and multiple figures in the feasibility report;
do not infer an FPS advantage from the library abstraction level alone.

The subsequent LaTeX investigation identified two concrete paths: projected SVG
scene annotations via existing Plotly APIs, and a native cached math-mesh seam
in a targeted Plotly/stack.gl fork. After access changed, the user authorized the
isolated probe. The no-fork annotation path now renders through real drag/zoom
and exports with a compositor in offline Chrome, including production CSP and
an opaque sandbox. Raw Plotly export omits the math; preserve ready SVG labels
and compose them with the scene for capture. Fixed anchors overlap geometry in
some views; a 20-step drag triggered 57-60 conversion calls. This supports
continued Plotly evaluation, not unconditional backend selection. See the
[measured investigation](plotly-latex-investigation.md#latest-measured-result)
and `data/visualization-review/plotly-latex-2026-11-13-v7/index.html`.

Following the user's agreement with preferring a fork, evaluate the
native cached-math-mesh path as the product direction. The measured workaround
costs justify that investigation: non-native placement, repeated conversion and
an export compositor. A pinned, narrow fork could reuse native title placement,
cached geometry and GL export; that outcome is not yet verified. Draft its exact
patch/I/O/test plan for approval before editing a fork or integrating a backend.
That plan is now [written separately](plotly-native-math-prototype-plan.md),
with exact release pins, internal mesh contracts, patch files and test commands.
It was approved and executed. Its [measured results](plotly-latex-investigation.md)
support continuing with the fork candidate. The title-clipping case is fixed;
worker/WebView gates and the final product contract/UX plan remain before adoption.

### Display proposal awaiting approval

These choices concern the learner's view of an already generated artifact.
They do not reopen approved time/camera controls.

| Behavior                   | Proposed learner experience                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expand                     | A dedicated Expand button opens the live figure in a large in-app overlay. Dragging continues to rotate 3D content. Expanding/closing preserves the same time, camera and play/pause state; it does not restart the figure.                                                                                                                 |
| Invert brightness          | The existing optional brightness switch is available on the new interactive card too, initially off for a new artifact. It changes the displayed white backing/dark strokes, using the existing inversion treatment for figure and legend together. Preserve the existing saved preference; downloaded content retains its original colors. |
| Loading                    | Show the stored preview with a loading indicator until the live runtime is ready; controls become active only after readiness.                                                                                                                                                                                                              |
| Viewer cannot run graphics | For an artifact that previously passed runtime verification, show the preview labeled as a static preview, an explanation that interaction is unavailable, and an explicit Retry button. Retry reloads the same artifact; it does not call a model or create a job.                                                                         |
| Viewer fails after loading | Stop playback, show a failure message and the labeled preview, and allow the same manual Retry. Do not silently repeat failures or present the preview as an interactive success.                                                                                                                                                           |

If generation-time verification fails, retain the approved job failure path;
a preview alone cannot satisfy the runtime-verification gate. Color inversion
may alter perceived surface shading/color scales, so this optional display
treatment still needs the user's approval rather than being assumed from old
SVG behavior.

## Proposed implementation boundaries

These are proposals carried forward from the handoff, updated with the host
integration findings. Final contracts and commands will be filled in after the
remaining decisions; this section does not authorize implementation.

### 1. Static geometry and visual-agent state

Create `src/core/contracts/visualization.ts`,
`src/agent/visualization/schema.ts`, `expression.ts`, `geometry.ts`, `labels.ts`,
`layout.ts`, `render.ts`, and `src/agent/subagents/visual-state.ts`.
Modify `src/core/contracts.ts`, `src/agent/plot-expression.ts`,
`src/agent/subagents/visual-maker.ts`, `src/agent/tools/jobs.ts`, and
`src/agent/prompts/teacher/50-demos.md`.
`src/core/index.ts` already re-exports `contracts.ts`; change it only if an
additional explicit export is necessary.

I/O: preserve old parser/compiler signatures; add explicit allowed-variable
numeric compilation; resolve geometry references independently of input order;
return static SVG; track output revisions and inspection delivered to a later
model call. A failed replacement invalidates the attempted output; it cannot
deliver a previous figure as if the replacement succeeded.

Create `tests/visualization-expression.test.ts`,
`tests/visualization-geometry.test.ts`, `tests/visualization-schema.test.ts`,
`tests/visualization-agent.test.ts`, and
`tests/fixtures/visualization/geometry.json`.
Acceptance includes a 3-4-5 triangle, computed hypotenuse, validated right angle,
reordered midpoint references, number-line positions, malformed references,
cycles, degeneracy, collision/callout behavior and the actual Pi tool validator.

### 2. Portable interactive artifacts and static 3D

Create runtime modules under `src/agent/visualization/runtime/`, the approved
runtime bundler/string module, and
`components/artifacts/interactive-visualization-card.tsx`.
Extract `components/artifacts/sandbox-frame.tsx` if approved for shared iframe
ownership. Modify the new contracts/schema/render service, `jobs.ts`, core result
branching, `src/agent/tools.ts`, `src/agent/tools/jobs.ts`,
`src/agent/subagents/runner.ts`, `visual-maker.ts`, both headless adapters,
`src/client/worker-client.ts`, `components/artifacts/steer-card.tsx`, and
`components/artifacts/demo-card.tsx`. Dependency/build files change only for the
approved backend and portable runtime packaging.

I/O: interactive HTML contains its runtime and assets; both execution paths
await readiness, seek requested times and export full frames including math
labels. A pure core validator distinguishes old SVG, valid interactive output
and failure. Persisted/projected delivery remains distinct from render success.

Create `tests/visualization-runtime.test.ts`,
`tests/visualization-browser.test.ts`, `tests/visualization-delivery.test.ts`,
and `tests/fixtures/visualization/plots-3d.json`.
Update `scripts/plot-benchmark/case-runner.ts`, `contracts.ts`, `report.ts`,
`scripts/plot-render-review.ts` and their existing tests for the new result
branch; preserve old reports and source evidence.
Acceptance: paraboloid, saddle, helix and supplied scatter points; offline
standalone HTML, actual Node and worker-host capture, math labels, CSP,
camera controls, failure/cleanup and persisted delivery. Native WebView behavior
remains unverified unless separately exercised.

### 3. Time-driven plots and geometry

Modify expression/schema/geometry/render/runtime modules and visual inspection
state. Create `tests/visualization-timeline.test.ts` and
`tests/fixtures/visualization/animations.json`.

I/O: explicit supplied time determines numeric state without accumulated
integration. Same time produces the same numeric scene regardless of seek
order. Start/middle/end images reach a later visual-agent model call; direct
plots record no model inspection. Implement the approved playback controls.
Acceptance: traveling wave, animated surface, moving point/vector and midpoint;
out-of-order seeks, pause/restart/camera reset, reduced motion, hidden documents,
fixed domains, errors, resize and disposal. GPU pixel identity is not promised.

### 4. Demo reuse, guidance and portable review

Modify `src/agent/subagents/demo-builder.ts`, `tests/demos.test.tsx`,
`src/agent/tools/jobs.ts`, and `src/agent/prompts/teacher/50-demos.md` according
to the approved reuse boundary and exact prompt text.
Create `docs/deterministic-visualization.md`,
`scripts/visualization-review.ts`, and `tests/visualization-review.test.ts`.

Review CLI: `node --import tsx scripts/visualization-review.ts --out <new-directory>`.
Input is checked-in fixtures, with no model calls; refuse existing output
directories. Output is `index.html`, `results.json`, original SVGs, portable
HTML artifacts and labeled time snapshots, including fixture hashes, backend
version, numerical evidence and failures. Static previews embed SVG image
documents so portable reviews preserve vector quality.

## Verification to retain in the final plan

All milestone commands must list exact files. Final verification includes the
handoff's existing regressions plus each new numerical/schema/agent/runtime/
browser/delivery/timeline/review test. For touched code run Prettier, ESLint
with automatic fixes and TypeScript; use `--no-ignore` for scripts. Preserve
each existing file's formatting convention. Run `npm run vite:build` after
runtime integration and `git diff --check`. Browser startup must work before
claiming runtime, offline or worker-host verification. No additional paid/live
benchmark is required by this plan.
