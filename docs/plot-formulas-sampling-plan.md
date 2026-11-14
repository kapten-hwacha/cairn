# Formula formatting and adaptive plot sampling

Status: approved by the user's “go”; implemented and verified, including the
independent-panel-domain follow-up selected by the user.

## Approved follow-up: independent panel x domains

The fresh three-case run delivered all artifacts, but its case-10 figure called
the second panel a zoom while reusing the overall x range. The user explicitly
selected independent panel x domains in response to this finding.

- Extend `PlotPanel` in `src/core/contracts/jobs.ts` with optional
  `xDomain?: [number, number]`. A supplied panel domain overrides the plot domain;
  an omitted domain inherits it. Each panel range is independently valid and
  need not be contained by the plot default. Keep the existing finite/ascending
  and positive-log-domain checks. All panels retain the selected global x scale.
- Extend the plot schema in `src/agent/tools/jobs.ts` with the same compatible
  homogeneous numeric domain array. Description: `Optional x-axis domain for this
  panel; overrides the plot-level xDomain. Use it for a zoomed view.` Add to the
  tool/teacher instructions: `Panels inherit the plot-level xDomain by default;
  set a panel's xDomain for an independent range, such as a zoomed view.`
- In `src/agent/plot.ts`, resolve each panel's effective domain before sampling
  or building Vega scales. Validate curve domains and hints against that panel
  domain. Preserve aligned panel rectangles; x ticks and positions use the
  independent panel scale rather than implying common coordinates.
- Add explicit overview/zoom regression fixtures and test SVG path geometry,
  domain fallback/validation, serialized panel-domain schemas and real offline
  worker rendering in the existing plot/schema/worker tests. Update the usage
  guide. Run the same format/lint/type/regression/build checks below.
- Preserve the first fresh three-case run. Run case 10 once more using DeepSeek
  Flash/high after the new panel contract is available; inspect its actual inputs
  and resulting SVG/PNG, with no automatic retries or timeout changes.

## Findings and intended result

- Case 02 saved `y = x^2 - 4` as ordinary title/legend text. The previous renderer
  correctly followed its old literal-text contract, but that contract does not
  meet the user's expectation. Format recognizable old formulas too.
- Case 09 contains 16 manually generated left-branch points and 17 right-branch
  points, rather than expressions. Linear interpolation has about 3.29 px error
  at x = -0.05 on the current chart. Increasing expression sampling alone cannot
  improve this input. Future calls should provide the known analytic expression;
  preserve measured/supplied point data without inventing intermediate values.
- Case 10's overview uses 801 uniform samples. Its sampled maximum is about
  0.000004785 at x = 0.12375, while the true maximum is 1 at x = 0.1234. The
  annotation supplies that x-coordinate, but the renderer does not sample it.
  The original benchmark timeout additionally involved a demo job; it is a
  separate outcome from the overview's sampling defect.

Keep `renderPlot(input: PlotInput): Promise<string>` and existing valid inputs.
Preserve all earlier reports/reviews and unrelated uncommitted work. No new
dependencies, desktop UI automation, commits or deployment are required.

## Proposed behavior

### Recognize mathematical labels conservatively

Preserve explicit math spans. For unmarked text, recognize complete expressions,
equations/comparisons and numeric coordinate pairs using a bounded parser, not
an LLM or broad prose replacement. Examples:

- `y = x^2 - 4` → `$y = x^{2} - 4$`.
- `exp(-x/2)*sin(3*x)` → typeset exponential/product with a fraction.
- `x < 0.123` → typeset comparison.
- `vertex (0, -4)` → ordinary `vertex` plus typeset coordinates.
- Axis labels consisting of a single variable become math; ordinary prose such
  as `minimum` stays text. Unknown or partly parsed strings stay literal.

Use the existing mathematical precedence and supported function names. Accept
Unicode minus/multiplication and pi in display recognition. Numeric expressions
retain their current grammar and validation. Explicit malformed LaTeX still
fails with its field name; automatic recognition must not change formula meaning.
Keep strict model instructions for cases outside the recognizable subset.

### Sample expressions according to visible error

- Keep supplied point curves exactly as supplied, joined with the current
  straight-line interpolation. No smoothing or inferred equation for measured
  data.
- Start expression curves with 801 evenly spaced samples in axis coordinates,
  including both endpoints. Add annotation x-coordinates that lie in the curve's
  domain, evaluating the expression there rather than using annotation y-values.
  Add optional explicit `sampleAt` hints for known small features without labels.
- Probe quarter, midpoint and three-quarter positions, then recursively refine
  intervals whose departure from the chord exceeds 0.5 vertical pixels in the
  chart's linear/log coordinates. Include discovered extrema in automatic y
  ranges. Off-screen portions should not consume the entire refinement budget.
- Bound work to 8192 unique evaluations per expression and 20 refinement levels.
  If visible geometry remains unresolved, fail with an actionable curve-specific
  error instead of silently presenting the unresolved approximation as complete.
  Nonfinite/invalid-log regions form gaps. Never bridge separately declared
  curve domains.
- Add optional expression-curve `xDomain: [min, max]` to declare branch domains;
  default to the plot's domain. Require finite, ascending bounds within the plot's
  domain (and positive bounds on log x). `sampleAt?: number[]` has at most 128
  finite coordinates inside that curve domain. Reject these expression-only
  options on point curves. Preserve DeepSeek-compatible homogeneous array schemas
  with exact domain length 2.
- A finite sampler cannot guarantee discovery of an arbitrarily narrow,
  unhinted feature. Document this limitation and encourage `sampleAt`/annotations
  for known extrema. Do not claim the pixel probe tolerance proves global accuracy.

For case 10, the annotation at x = 0.1234 must become an evaluated sample with
y = 1. Adaptive refinement must resolve the adjacent shape; keep the full-domain
overview and zoom. On a 620 px overview the peak is narrower than a pixel, so the
overview can show its height/location but the zoom is needed to see its shape.

For case 09, future model calls should use `1/(x-0.123)` in two expression curves
with domains `[-1, 0.123]` and `[0.123, 1]`. The renderer samples/refines the actual
function on each branch. No curve connects across the pole. This change does not
add a new asymptote/reference-line API; that remains separate.

### Make the authoring instructions explicit

Replace the current permissive label-authoring sentence in the plot tool and
teacher prompt with this exact text:

> Write every formula and mathematical symbol in titles, axis labels, legends and annotations using $...$; keep explanatory prose outside the delimiters. For example: $y=x^2-4$, $x$ (s), and vertex $(0,-4)$. Keep numeric expressions in the expression grammar, without LaTeX delimiters. For a known analytic function, supply an expression rather than invented sample points; reserve points for supplied or measured data. At discontinuities, split expressions into separate curves with non-crossing xDomain intervals. Use sampleAt for important narrow features. For static plot requests, use plot; create a demo only when the learner requests interactivity.

## Files and interfaces

| Path | Work and contract |
| --- | --- |
| `src/agent/plot-expression.ts` (new) | Export `parsePlotExpression(source: string, mode: "numeric" \| "display" = "numeric"): PlotExpression` and `compilePlotExpression(source: string): (x: number) => number`. The AST has number (raw text/value), identifier (name), unary (operator/operand), binary (operator/left/right), and call (name/arguments) nodes. Numeric grammar stays unchanged; display parsing additionally admits single-letter identifiers. Equation/comparison splitting belongs to the formatter. Retain `evaluatePlotExpression` as the existing public wrapper in `plot.ts`. |
| `src/agent/plot-math-format.ts` (new) | `formatRecognizedPlotMath(source: string): string`; preserve existing math and escaped dollars, convert only completely recognized formulas/coordinate spans into canonical delimited LaTeX, leave prose literal. |
| `src/agent/plot-labels.ts` | Normalize label text through the formatter before tokenization; retain original source in accessibility descriptions and errors. Keep existing font/path/layout behavior. |
| `src/agent/plot-sampling.ts` (new) | `samplePlotExpression(evaluate: (x: number) => number, options: PlotSamplingOptions): PlotSample[]`; options carry effective x domain/scales, optional y domain, pixel width/height, and seed x values. Samples preserve x order and explicit segment IDs for gaps. Export constants for the evaluation/depth/tolerance limits and test them. |
| `src/agent/plot.ts` | Use the shared expression compiler and adaptive sampler. Feed per-curve domains/hints plus in-domain annotation x seeds; pass returned segment IDs to both drawing and collision geometry. Retain point-curve behavior and error cleanup. |
| `src/core/contracts/jobs.ts` | Extend `PlotCurve` with optional expression-only `xDomain?: [number, number]` and `sampleAt?: number[]`; document semantics. |
| `src/agent/tools/jobs.ts` | Add optional curve schema fields using the existing compatible domain schema and bounded numeric array; update description with approved exact authoring text. |
| `src/agent/prompts/teacher/50-demos.md` | Use the same exact authoring text in the plot section. |
| `tests/plot-math-format.test.ts` (new), `tests/plot-labels.test.ts` | Precedence/associativity, formula 02, equation/comparison/coordinate recognition, mixed explicit math, escaped dollars, prose preservation and unsupported ambiguous strings. |
| `tests/plot-sampling.test.ts` (new) | Independent analytic expectations for parabola, composed functions, log sampling, narrow peaks at multiple off-grid centers, branch domains, nonfinite/log gaps, measured-point preservation, and bounded-work errors. Verify the case-10 maximum and screen-space error against independent dense reference samples. |
| `tests/plot.test.ts`, `tests/plot-tool-schema.test.ts`, `tests/plot-benchmark-flow.test.ts`, `tests/plot-worker.test.ts` | Integrate formatting/sampling through real SVG/PNG/job/worker paths; ensure schemas serialize correctly for the new nested domain. Keep worker offline checks and no-dynamic-code-generation coverage. |
| `tests/fixtures/plot-sampling/cases.json` (new) | Case 02 unmarked formulas; case 09 analytic split branches; case 10 overview/zoom plus unrelated off-grid peak cases. Preserve original fixtures and source run. |
| `tests/fixtures/plot-sampling/review-variants.json` (new) | `{ schemaVersion: 1, variants: [{ caseId: "09-discontinuity", attempt: 1, plotIndex: 1, input: PlotInput, reason: string }] }`. Reason: `Replaced model-generated approximation points with the stated analytic function, split at x=0.123; original input retained.` Indexes are one-based within the saved plot jobs. |
| `scripts/plot-render-review.ts`, `tests/plot-render-review.test.ts` | Add optional `--variants <file>` and `renderReview(run, output, variantsFile?: string)`. Validate variant inputs with the real tool schema and reject duplicate/missing target identities. Keep the original render pairs, append clearly labeled variant pairs, and record `inputProvenance: { kind: "original" \| "variant", originalInputHash: string, reason: string \| null }` per output. Remove the unconditional unchanged-geometry claim. Verify no source changes or model calls and correct provenance. |
| `docs/plot-benchmark.md` | Document recognized math subset, sampling limits, curve-domain/hint contracts, and provenance of derived input reviews. |

## Verification and review

1. Add failing numerical/formatting regressions and implement the independent
   parser/formatter/sampler with their focused tests.
2. Wire the renderer/contracts/tool instructions and verify actual outgoing
   schemas, finite gaps, domain validation and unchanged measured points.
3. Run formatting/lint fixes on every changed TypeScript file; run:

```sh
npm exec -- prettier --check --use-tabs src/agent/plot*.ts src/agent/tools/jobs.ts src/core/contracts/jobs.ts tests/plot-math-format.test.ts tests/plot-sampling.test.ts tests/plot-labels.test.ts tests/plot-layout.test.ts tests/plot.test.ts tests/plot-render-review.test.ts tests/plot-worker.test.ts
npm exec -- prettier --check scripts/plot-render-review.ts tests/plot-tool-schema.test.ts tests/plot-benchmark-flow.test.ts tests/fixtures/plot-sampling/*.json
npm exec -- eslint --no-ignore src/agent/plot*.ts src/agent/tools/jobs.ts src/core/contracts/jobs.ts tests/plot*.test.ts scripts/plot-render-review.ts
npm run typecheck
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-math-format.test.ts tests/plot-sampling.test.ts tests/plot-labels.test.ts tests/plot-layout.test.ts tests/plot.test.ts tests/plot-tool-schema.test.ts tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/plot-render-review.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending.test.ts
NODE_ENV=test node --import tsx --test tests/plot-worker.test.ts
npm run vite:build
git diff --check
```

4. Generate a new deterministic gallery from the original inputs. It should fix
   02 and 10 directly; explicitly retain 09's original point input and show a
   separately labeled analytic-input revision. Preserve all original evidence.
   Inspect the revised 02, both 10 views and 09 branches in SVG and PNG.

```sh
node --import tsx scripts/plot-render-review.ts --run data/plot-benchmark/2026-11-12T15-27-19-556Z-99c65385 --out data/plot-render-review/formulas-sampling-v1 --variants tests/fixtures/plot-sampling/review-variants.json
```
5. Run cases 02, 09 and 10 once through the real teacher with DeepSeek Flash/high,
   into a fresh benchmark directory, with no automatic attempt retries:

```sh
npm run benchmark:plot -- --profile-dir "/Users/hwacha/Library/Application Support/com.hwacha.cairn-dev" --model deepseek:deepseek-flash --thinking high --case 02-quadratic --case 09-discontinuity --case 10-narrow-peak --repetitions 1
```

Report mathematical/presentation review separately from delivery outcomes. Do not
rewrite the original timeout outcome or silently lengthen the benchmark deadline.

## Completion evidence and remaining review finding

- Implemented the typed expression parser, conservative formula formatter,
  bounded adaptive sampler, per-curve domains/hints and independent per-panel
  domains. Fixed a clipping regression in the previous SVG tick conversion:
  LiteDOM lowercased `clipPath`, allowing out-of-range strokes to overwrite
  titles. Source SVG tag casing is now preserved; a strict SVG/raster regression
  checks that colored curve strokes stay inside the plotting rectangle.
- Final checks: 163 related tests across 26 suites plus one real browser-worker
  test passed (164 total). The worker test covers Bode panels, analytic reciprocal
  branches, and the independent overview/zoom. ESLint, Prettier, TypeScript,
  desktop Vite build and `git diff --check` passed. Existing Vite large-chunk and
  `https-proxy-agent`/`assert` externalization warnings remain.
- Deterministic gallery:
  `data/plot-render-review/formulas-sampling-v2/index.html`.
  All thirteen renders succeeded, including an explicitly labeled analytic-input
  revision for case 09. Chrome decoded all 26 before/after images with no broken
  images or horizontal overflow. A recursive source-run hash confirmed the
  original benchmark evidence was unchanged.
- Three-case live run:
  `data/plot-benchmark/2026-11-12T20-33-21-814Z-d3008860/index.html`.
  All three cases delivered artifacts (02: 10.285 s, 09: 27.212 s, 10: 20.886 s).
  Image review caught the mislabeled zoom in case 10; the user selected independent
  panel domains in response. This run and its outcomes were preserved.
- Follow-up case-10 live run:
  `data/plot-benchmark/2026-11-12T20-43-09-465Z-7e337843/index.html`.
  Delivered in 27.092 s. The teacher used a second-panel `xDomain` of
  `[0.1232, 0.1236]`; the resulting overview reaches height 1 and the zoom shows
  the Gaussian shape. No demo job or timeout occurred. This is verification of
  the newly selected panel feature, not an automatic retry of an unchanged case.
- Consolidated live review:
  `data/plot-render-review/formulas-sampling-live/index.html`.
  This page explicitly combines cases 02/09 from the three-case run and 10 from
  the follow-up; each original report is linked, and `sources.json` records their
  provenance. It is not presented as one combined benchmark run.
- Remaining model-authored annotation error in the latest case 10: the e⁻¹ label
  is anchored at `(0.123233, 0.37)` rather than either actual e⁻¹ point,
  `x = 0.1233` or `0.1235`. The curve, peak height and panel zoom are correct.
  This is called out in the review page; the saved input, annotation and outcome
  were not silently corrected. It does not establish a mathematical quality pass.
- All live runs used DeepSeek Flash/high, unchanged 120-second deadlines and no
  automatic benchmark retries. Source profile and original evidence/reviews were
  preserved. No new dependency, commit or deployment was made.
