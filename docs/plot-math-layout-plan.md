# Plot math and annotation layout

Status: approved by the user's “continue”; implemented and verified.

## Goal and scope

Render math consistently in plot titles, axis titles, legends and annotations,
and place annotations without covering curves or other labels. Keep
`renderPlot(input: PlotInput): Promise<string>` and the existing tool input
shape. Preserve saved benchmark evidence and unrelated uncommitted work.

This change covers presentation. Expression evaluation, the 801-point sampling
rule, asymptote/reference-line support, teacher verbosity and report transcript
formatting remain separate work.

## Proposed behavior requiring approval

1. Labels accept ordinary text mixed with `$...$` inline LaTeX. Accept existing
   `$$...$$`, `\(...\)` and `\[...\]` delimiters too, typeset at inline label
   size. `\$` means a literal dollar sign. Undelimited text stays literal:
   `x^2` is text; `$x^2$` is typeset math. Numeric expressions still use the
   existing expression grammar, independently of their display labels.
2. Use MathJax 4.1.3 with its bundled classic TeX font (matching package
   `@mathjax/mathjax-tex-font` 4.1.3). Use one consistent TeX font family for
   human-authored plot labels, including ordinary text, so glyph dimensions
   are available without a browser. Numeric tick formatting stays with Vega.
   All label glyphs and required resources are embedded in the SVG.
3. Malformed/unclosed math, unsupported commands or unsupported glyphs fail the
   plot job with an error identifying the label field. Do not silently replace
   a formula, hide a label, or emit a successful figure containing a math error.
   Use bundled base/AMS/text support; no runtime extension or font downloads.
4. Try deterministic positions around each annotation anchor, using measured
   label rectangles and curve segments in pixel coordinates. Stay within the
   plotting rectangle and avoid other labels and point markers. Add a leader
   line when displacement makes the anchor relationship unclear. If no position
   fits, retain a numbered anchor with the full label in a callout list below
   that panel. Long prose labels wrap; indivisible math that exceeds the label
   width fails with an actionable error rather than clipping or tiny text.
5. Retain the current 620 by 250 pixel data area per panel and stack up to four
   panels. Reserve measured space for titles, rotated y-axis titles, x-axis
   titles, legends and overflow callouts. Keep shared x domains and independent
   panel y/color scales. Label layout must not change numerical data/domain.
6. First verify by re-rendering the saved plot inputs from the existing run,
   without model calls. Produce a separate before/after gallery and leave all
   original reports, outcomes and manual reviews untouched. A new live model
   benchmark is not needed to judge this deterministic presentation change.

## Repository findings and approach

`src/agent/plot.ts` currently passes all strings directly to Vega text marks;
annotations always receive `dx: 7, dy: -7`. Vega's native label transform uses
Canvas bitmaps when avoiding curves, while this renderer runs without a DOM or
Canvas in Node and in the desktop worker. Use geometry-based placement here.

MathJax's direct module API and LiteDOM adaptor can generate SVG without a
browser. The classic TeX font avoids the dynamic font-range loading used by
MathJax's newer fonts. Import only the needed modules and font data; avoid the
global startup/component loader. Validate the actual worker build, not just
Node imports. Use paths with no external CSS/font dependency or shared page IDs.

Vega continues to compute scales, numerical axes, grid and curves. Generate
each panel's chart with numeric ticks but without human-authored text marks;
use its actual scale functions, origin and SVG bounds when composing the
measured vector labels. Align plot rectangles across the stacked panels. This
avoids treating already-escaped SVG strings as a place to guess label identity
or globally overriding Vega's text metrics during concurrent render jobs.

References: [MathJax direct API](https://docs.mathjax.org/en/latest/server/direct.html),
[font loading](https://docs.mathjax.org/en/latest/output/fonts.html),
[self-contained SVG](https://docs.mathjax.org/en/latest/options/output/svg.html),
[Vega label transform](https://vega.github.io/vega/docs/transforms/label/).

## Files and contracts

| Path | Change / contract |
| --- | --- |
| `package.json`, `package-lock.json` | Add exact runtime dependencies `@mathjax/src@4.1.3` and `@mathjax/mathjax-tex-font@4.1.3`. Preserve existing dependency changes. |
| `src/agent/plot-labels.ts` (new) | `typesetPlotLabel(source: string, field: string, fontSize: number, maxWidth: number): Promise<PlotLabel>`; `PlotLabel = { svg: string; width: number; height: number; baseline: number; accessibleText: string }`. Tokenize mixed text/math; produce escaped, self-contained SVG and measured bounds. Errors identify the input field. |
| `src/agent/plot-layout.ts` (new) | Pure `placePlotAnnotations(labels: PlotAnnotationLabel[], obstacles: PlotObstacle[], width: number, height: number): PlotAnnotationLayout`; input labels carry `anchor: { x, y }` in pixels and measured width/height. Obstacles are point circles or line segments, retaining gaps. Output contains placed label rectangles/leader lines and ordered numbered overflow callouts. Stable input produces stable placement. |
| `src/agent/plot.ts` | Keep exported expression evaluator and render signatures. Compose numerical Vega panels with measured labels, layout and accessible SVG descriptions. Do not change sampled values or domain validation. Finalize every Vega view on success/error. |
| `src/agent/tools/jobs.ts` | Add to the plot tool description: `Titles, axis labels, curve labels and annotation labels accept plain text mixed with inline LaTeX in $...$. Keep numeric expressions in the expression grammar, without LaTeX delimiters.` Input schema and tuple compatibility stay unchanged. |
| `src/agent/prompts/teacher/50-demos.md` | Add the same label-authoring sentence to the plot paragraph. Do not rewrite the teaching policy. |
| `tests/plot-labels.test.ts` (new) | Mixed text/math, delimiters, escaping, malformed/unsupported math, measured multiline bounds, self-contained paths, repeated labels/concurrent renders, bounded long-label behavior. |
| `tests/plot-layout.test.ts` (new) | Label/curve/marker collision avoidance, edge anchors, leader lines, overflow preservation, deterministic order, nonoverlapping output rectangles. |
| `tests/plot.test.ts` | Integration: math in every label role, correct rotated axis/title/legend layout, independent panels with aligned x coordinates, annotation callouts, SVG/PNG rendering and existing numerical/domain regressions. Retain the no-dynamic-code-generation check. |
| `tests/fixtures/plot-layout/cases.json` (new) | Saved plot inputs from sine/cosine, log–log, Bode, parabola minimum and narrow-peak zoom. Include a deliberately crowded annotation case and mixed math/plain/Unicode labels. Expected numerical geometry remains unchanged. |
| `tests/plot-worker.test.ts` (new) | Bundle a minimal worker importing the real renderer using Vite; run it in headless Chromium. With network requests blocked, render math labels and multiple panels, rasterize the resulting SVG, and verify the result. No desktop automation or API calls. |
| `scripts/plot-render-review.ts` (new) | CLI `--run <existing-run-dir> --out <new-directory>`; validate saved plot job inputs, call the real renderer, save new SVG/PNG files and an escaped static before/after HTML gallery. Never write source evidence. Return nonzero and retain per-input errors if any render fails. |
| `docs/plot-benchmark.md` | Document the deterministic render-review command, supported label authoring and scope of visual verification. |

## Implementation order and acceptance checks

1. Add dependencies and implement label typesetting with its focused tests.
   Verify TeX, ordinary text, units and Unicode from the saved inputs. Check
   invalid labels produce field-specific errors and SVGs need no external assets.
2. Implement pure geometry layout and tests. Use actual stroked segment
   intersections, rather than sample-point-only tests that can miss a line
   crossing a label rectangle. Preserve every annotation through overflow.
3. Integrate panel composition and update the two exact authoring descriptions.
   Check all label roles, rotated labels, log coordinates, curve colors, panel
   alignment, cleanup and concurrent renders. Assert numerical inputs and sampled
   curve geometry are unchanged by label contents.
4. Verify the worker bundle and raster output; record worker bundle size change.
   If module/font loading prevents offline worker operation, stop and revise the
   dependency approach before changing the product contract.
5. Add the render-review CLI and documentation. Re-render every saved plot input
   into a new directory and visually inspect the complete gallery, including the
   existing minimum and narrow-peak zoom collisions. Original run evidence must
   be unchanged. Numerical defects observed previously remain visible.

Run formatter and linter fixes on every modified TypeScript file, then:

```sh
npm exec -- prettier --check --use-tabs src/agent/plot.ts src/agent/plot-labels.ts src/agent/plot-layout.ts src/agent/tools/jobs.ts tests/plot.test.ts tests/plot-labels.test.ts tests/plot-layout.test.ts tests/plot-worker.test.ts
npm exec -- prettier --check scripts/plot-render-review.ts tests/fixtures/plot-layout/cases.json
npm exec -- prettier --check --use-tabs package.json package-lock.json
npm exec -- eslint --no-ignore src/agent/plot.ts src/agent/plot-labels.ts src/agent/plot-layout.ts src/agent/tools/jobs.ts tests/plot.test.ts tests/plot-labels.test.ts tests/plot-layout.test.ts tests/plot-worker.test.ts scripts/plot-render-review.ts
npm run typecheck
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-labels.test.ts tests/plot-layout.test.ts tests/plot.test.ts tests/plot-tool-schema.test.ts tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending.test.ts tests/plot-worker.test.ts
npm run vite:build
node --import tsx scripts/plot-render-review.ts --run data/plot-benchmark/2026-11-12T15-27-19-556Z-99c65385 --out data/plot-render-review/math-layout-v1
git diff --check
```

Worker checks may require the normal local Chrome launch permission. Report
that separately from renderer failures. No commits or deployment are included.

## Completion evidence

- Added `tests/plot-render-review.test.ts` to verify no network requests,
  source preservation, output-directory protections and retained render errors.
  Added a discontinuity fixture to catch XML escaping in labels containing `<`
  and `>`. MathJax inline fragment splitting and plain-text whitespace each have
  explicit regressions. Numeric ticks retain Vega's formatting and are also
  converted to vector paths for font-independent worker rasterization.
- Final related suite: 147 tests across 26 suites passed; the separate real
  browser-worker test passed, for 148 tests total. ESLint fixes/checks, Prettier,
  TypeScript, the desktop Vite build and `git diff --check` passed. Vite still
  reports its large-chunk warning and a pre-existing `assert` externalization
  warning from `https-proxy-agent`.
- The worker test bundles the real renderer, runs it under headless Chrome with
  external requests blocked, decodes its SVG into PNG, and checks its path data
  against Node output. Node rasterization also passes with system fonts disabled.
- Isolated unminified worker bundles: Vega-only comparison 1,142,839 bytes;
  complete math/layout renderer 4,191,331 bytes; difference 3,048,492 bytes.
  This is a comparison of isolated test bundles, not an exact app bundle delta.
  The desktop build's complete worker entry is about 6.77 MB. The additional
  bundled math code/font data is a material size cost of this approach.
- Final gallery: `data/plot-render-review/math-layout-v4/index.html`.
  All twelve saved plot inputs rendered successfully. Reviewed every updated
  plot plus the crowded-label fixture. Chrome decoded all 24 before/after
  images, with no broken images or horizontal overflow at 1600 px. Every plot's
  numerical curve SVG path data exactly matches the original. A recursive hash
  of the source benchmark run before/after regeneration confirmed no changes.
- No model calls, live retries, source-profile changes, sampling changes or
  asymptote semantics changes were made. Existing benchmark outcomes and manual
  review records are preserved. No commit or deployment was performed.
