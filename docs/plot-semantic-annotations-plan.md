# Computed plot annotations

Status: approved by the user's “yes”; implemented and verified.

## Goal and scope

Bind analytic annotations to the plotted function so that marker coordinates and
displayed numeric values come from the same computation. First support points at
a supplied x coordinate and bracketed crossings of a supplied y level. Preserve
existing inputs and reports. Extrema searches, automatic interpretation of prose,
and interpolation of measured data are outside this change. No new dependencies.

## Public input contract

In `src/core/contracts/jobs.ts`, add optional `PlotCurve.id?: string`, unique
within a panel. IDs must be nonempty and contain at most 64 characters. Existing
curves need no ID unless referenced. Export this `PlotAnnotation` union:

```ts
type PlotAnnotation =
  | { kind?: "point"; x: number; y: number; label: string }
  | { kind: "note"; x: number; y: number; label: string }
  | { kind: "curve-point"; curveId: string; x: number; label: string }
  | {
      kind: "level-crossing";
      curveId: string;
      level: string;
      xBracket: [number, number];
      label: string;
    };
```

`PlotPanel.annotations` becomes `PlotAnnotation[]`. Old `{x,y,label}` annotations
retain their marker, label and positioning behavior. `note` uses the same label
layout and leader but omits the data-point marker. Semantic kinds reference an
expression curve in the same panel; point-data curves are rejected with an
actionable error. They do not accept a separately supplied y coordinate.

For semantic kinds, `label` is a descriptive caption. The renderer appends
`$x\\approx <value>,\\ y\\approx <value>$`, with values rounded to 12 significant
digits, negative zero normalized, and scientific notation typeset as math.
For level crossings it also includes the requested level as mathematical text.
Free captions remain model-authored: this validates coordinates and generated
values, not arbitrary claims such as "maximum" in prose.

## Resolution and numerical limits

Create `src/agent/plot-annotations.ts` with:

```ts
interface ResolvedPlotAnnotation {
  x: number;
  y: number;
  label: string;
  marker: boolean;
}
function resolvePlotAnnotations(
  panel: PlotPanel,
  options: {
    xDomain: [number, number];
    xScale: "linear" | "log";
    field: string;
  },
): ResolvedPlotAnnotation[];
```

- Resolve before sampling, automatic y-domain calculation, or layout. Resolved
  x coordinates seed expression sampling; all marker/leader/scaling code uses
  resolved coordinates. Do not mutate input objects.
- Validate IDs and references, maximum 40 annotations, finite coordinates, and
  positive log coordinates. Semantic points and brackets must lie inside both
  the effective panel domain and the referenced curve's branch domain. Retain
  legacy off-screen coordinate behavior.
- A curve point evaluates its expression exactly at the supplied x. Reject a
  nonfinite value or a nonpositive result on log y.
- A level is a constant expression in the existing safe grammar, e.g.
  `exp(-1)`. Reject ASTs containing `x`, nonfinite levels, and nonpositive levels
  on log y. Reuse the existing parser/compiler, without dynamic code generation.
- Require a finite, strictly ascending bracket. Evaluate both ends; accept a
  single endpoint meeting the residual tolerance, reject two matching endpoints
  as ambiguous, otherwise require opposite residual signs. Bisect in numeric
  x space, with at most 128 midpoint evaluations. Return only a finite evaluated
  point satisfying `abs(f(x)-level) <= 1e-10 * max(1, abs(level))`.
- If a midpoint is nonfinite, floating-point progress stops, or the budget is
  exhausted before meeting the residual tolerance, fail with the annotation
  field and advice to provide a continuous, tighter bracket. A sign change at a
  pole alone must never count as a crossing. Store actual `f(x)` as resolved y.
- The author must isolate the intended crossing on a continuous branch. This is
  a bounded numerical solve, not a proof of continuity or root uniqueness. It
  does not discover tangencies or all crossings. The absolute tolerance floor
  above is documented; no claim of universal relative accuracy at tiny levels.

## Files and implementation tasks

1. `src/core/contracts/jobs.ts`, `src/agent/tools/jobs.ts`: add the public types,
   curve ID and strict annotation-union schemas. Preserve DeepSeek-compatible
   homogeneous numeric arrays of exactly two entries for brackets. Disallow
   mismatched semantic fields rather than silently ignoring a supplied y.
   Extend `tests/plot-tool-schema.test.ts` to validate each kind through Pi,
   malformed unions and serialized bracket shapes.
2. `src/agent/plot-annotations.ts` (new),
   `tests/plot-annotations.test.ts` (new): implement the resolver and independent
   numeric tests. Verify Gaussian crossings at x=0.1233 and 0.1235 for level
   exp(-1), another Gaussian center/width/level, polynomial crossings, endpoint
   roots, log scales, branch/panel bounds, unknown/duplicate IDs, measured-curve
   rejection, missing brackets, constant/ambiguous levels, poles, nonfinite
   regions, precision/budget failures, input immutability and generated labels.
3. `src/agent/plot.ts`: resolve once per panel, then pass resolved annotations to
   sampling, Vega domain contributions and existing collision layout. Draw
   markers only when `marker` is true. Preserve `renderPlot(input): Promise<string>`.
   Extend `tests/plot.test.ts` to compare computed marker coordinates against
   independent expectations, confirm sampled curve geometry contains those
   points, check notes have no marker, and retain legacy SVG behavior.
4. `src/agent/tools/jobs.ts`, `src/agent/prompts/teacher/50-demos.md`: append this
   exact authoring instruction to both plot descriptions:

   > For annotations on analytic curves, give the curve a unique id and use kind curve-point with curveId and x, or kind level-crossing with curveId, a constant level expression such as exp(-1), and xBracket isolating one crossing on a continuous branch. The renderer computes coordinates and appends their values; keep label descriptive and do not repeat manually calculated coordinates. Use kind note with x, y and label for explanatory text that is not a data point. Explicit point coordinates are for supplied or measured points. Narrow the bracket if a crossing cannot be resolved.

5. `tests/fixtures/plot-annotations/cases.json` (new): deterministic Gaussian
   overview/zoom with computed peak point and both exp(-1) crossings, another
   function, and notes. `tests/plot-worker.test.ts`: include these inputs in the
   real offline browser-worker SVG/PNG checks. `docs/plot-benchmark.md`: document
   the API, numerical limitations and caption boundary.
6. `tests/fixtures/plot-annotations/review-variants.json` (new): use the existing
   review-variant contract to retain the saved case-10 plot and append a clearly
   labeled semantic-input revision with both actual level crossings. Generate
   `data/plot-render-review/semantic-annotations-v1/index.html` with embedded PNG
   previews. Add reusable embedded PNG preview output in
   `scripts/plot-render-review.ts` and cover it in
   `tests/plot-render-review.test.ts` so the missing-image issue does not recur.
   Preserve originals and record changed-input provenance.

## Verification

Run formatter and linter with automatic fixes on every modified TS file, using
the existing tab convention except spaces in the review script/schema tests.
Then run:

```sh
npm exec -- prettier --check --use-tabs src/agent/plot-annotations.ts src/agent/plot.ts src/core/contracts/jobs.ts src/agent/tools/jobs.ts tests/plot-annotations.test.ts tests/plot.test.ts tests/plot-worker.test.ts
npm exec -- prettier --check scripts/plot-render-review.ts tests/plot-tool-schema.test.ts
npm exec -- prettier --check --use-tabs tests/plot-render-review.test.ts
npm exec -- prettier --check docs/plot-semantic-annotations-plan.md docs/plot-benchmark.md src/agent/prompts/teacher/50-demos.md tests/fixtures/plot-annotations/*.json
npm exec -- eslint --no-ignore src/agent/plot-annotations.ts src/agent/plot.ts src/core/contracts/jobs.ts src/agent/tools/jobs.ts scripts/plot-render-review.ts tests/plot-annotations.test.ts tests/plot.test.ts tests/plot-tool-schema.test.ts tests/plot-worker.test.ts tests/plot-render-review.test.ts
npm run typecheck
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-annotations.test.ts tests/plot.test.ts tests/plot-tool-schema.test.ts tests/plot-labels.test.ts tests/plot-math-format.test.ts tests/plot-sampling.test.ts tests/plot-layout.test.ts tests/plot-render-review.test.ts tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending.test.ts
NODE_ENV=test node --import tsx --test tests/plot-worker.test.ts
npm run vite:build
git diff --check
node --import tsx scripts/plot-render-review.ts --run data/plot-benchmark/2026-11-12T20-43-09-465Z-7e337843 --out data/plot-render-review/semantic-annotations-v1 --variants tests/fixtures/plot-annotations/review-variants.json
npm run benchmark:plot -- --profile-dir "/Users/hwacha/Library/Application Support/com.hwacha.cairn-dev" --model deepseek:deepseek-flash --thinking high --case 10-narrow-peak --repetitions 1
```

Inspect the deterministic PNGs and the single fresh live run's actual input,
SVG and PNG. Verify all review previews decode when the HTML is copied alone.
Report delivery and mathematical review separately; preserve all earlier runs,
use the existing timeout, and do not retry unchanged live cases automatically.

## Completion evidence

- Added stable curve IDs, computed curve points and bracketed level crossings,
  generated value labels, free notes without data markers, and compatible legacy
  inputs. The bounded resolver rejects unresolved crossings and sign changes at
  poles. No new dependencies or commits.
- 194 regression tests across 26 suites passed, plus the real offline browser
  worker test covering both new fixtures (195 tests total). Prettier, ESLint,
  TypeScript, Vite desktop build and `git diff --check` passed. The build retains
  the existing large-chunk and `https-proxy-agent`/`assert` warnings.
- Deterministic comparison:
  `data/plot-render-review/semantic-annotations-v1/index.html`. Both original and
  revised inputs rendered successfully. Gaussian crossings land at x=0.1233 and
  0.1235. Chrome decoded all four embedded PNG previews with no horizontal
  overflow after copying the HTML alone. Source-run file hashes stayed unchanged.
- Fresh DeepSeek Flash/high case-10 run:
  `data/plot-benchmark/2026-11-12T22-13-29-112Z-d8acb433/index.html`.
  Delivered in 29.367 seconds. The model used computed peak points and a
  level-crossing annotation with bracket `[0.1234, 0.12355]`; the resolver returned
  x=0.12350000000001166, y=0.3678794410856513, within the specified residual
  tolerance. Independent panel zoom and plot height are correct. No retries or
  timeout changes.
- Portable review of that live result:
  `data/plot-render-review/semantic-annotations-live/index.html`.
  Inspected its PNG: the level marker lies on the right side of the Gaussian.
  The model still repeated coordinates in its descriptive captions despite the
  authoring instruction. Those captions remain model-authored; the renderer
  validates computed anchors and appends computed values, not arbitrary prose.
