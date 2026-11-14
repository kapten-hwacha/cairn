# Headless plotting benchmark

Run a natural-language request through the production teacher, plot dispatch,
background runner, saved conversation and UI projection. The harness runs in Node
with isolated in-memory stores. It reads the app profile's SQLite settings and
prompt overrides without modifying them. It does not automate the desktop UI.

## Run

### Review renderer changes without model calls

Re-render the plot inputs from an existing benchmark into a new directory:

```sh
node --import tsx scripts/plot-render-review.ts \
  --run data/plot-benchmark/2026-11-12T15-27-19-556Z-99c65385 \
  --out data/plot-render-review/math-layout-v1
```

Open the output's `index.html` for original and updated figures side by side;
new PNGs and field-specific render errors are retained too. The command makes
no model calls and never changes the source run or its reviews. It refuses an
existing output directory or output inside the source run.
PNG previews are embedded directly in the HTML and remain visible when the HTML
is copied alone. SVG/download links still refer to the adjacent output files.

Plot labels accept ordinary text mixed with `$...$` inline LaTeX. Legacy
`$$...$$`, `\(...\)` and `\[...\]` spans also render at label size; use `\$`
for a literal dollar. Recognizable unmarked expressions, equations, comparisons
and numeric coordinate pairs are automatically typeset too: `y = x^2 - 4`
becomes mathematical text, as does the coordinate in `vertex (0, -4)`.
Recognition requires a complete parse; unknown prose or partial expressions
stay literal. Explicit math remains the preferred authoring form. Math and ordinary label
glyphs are embedded as vector paths using the bundled MathJax TeX font, so
exports do not need page CSS, fonts or network access. Malformed math,
unsupported glyphs/commands and indivisible labels wider than their available
space fail the plot job with the field name, allowing the teacher to correct it.
Annotations avoid curves and other labels; labels that cannot fit become
numbered callouts below the panel. This gallery does not certify mathematical correctness.

Expression curves start with 801 samples in linear/log axis coordinates, then
probe/refine intervals toward a 0.5 vertical-pixel error target. Refinement is
bounded at 8192 unique evaluations per expression and 20 levels; unresolved
visible geometry produces an actionable curve-specific error. A finite sampler
can still miss an arbitrarily narrow unhinted feature. Supply `sampleAt: [x, ...]`
(at most 128 coordinates) for known narrow extrema. In-domain annotation
x-coordinates are sampled too, by evaluating the expression rather than trusting
the annotation's y-value. For discontinuities, split analytic expressions into
separate curves with `xDomain: [min, max]` inside their panel's effective domain.
Curve `xDomain` and `sampleAt` are expression-only options. Supplied point curves are
never resampled or smoothed. Reference/asymptote-line support remains separate.

Each panel may also specify `xDomain: [min, max]` to override the plot-level
default range. For example, a figure can use overall `[0, 1]` and set a second
panel to `[0.1230, 0.1238]` for a true zoom. Omitted panel domains inherit the
plot range. Panel ranges are independent, while all panels retain the selected
x scale and aligned plotting rectangles. Curve domains and `sampleAt` values
are checked against their own panel's range.

### Computed annotations

Give an expression curve an `id` to reference it from an annotation in the same
panel. IDs are nonempty, at most 64 characters, and unique within that panel.
The following forms derive coordinates from the actual expression:

```json
{
  "kind": "curve-point",
  "curveId": "gaussian",
  "x": 0.1234,
  "label": "Peak"
}
```

```json
{
  "kind": "level-crossing",
  "curveId": "gaussian",
  "level": "exp(-1)",
  "xBracket": [0.1232, 0.1234],
  "label": "Left width point"
}
```

For `exp(-((x-0.1234)/0.0001)^2)`, that bracket produces x=0.1233 and
y approximately 0.367879441171. A second bracket `[0.1234, 0.1236]` produces
x=0.1235. `level` uses the numeric expression grammar but cannot contain x.
The renderer appends computed x/y values, rounded to 12 significant digits, and
the requested level. Keep `label` descriptive; arbitrary mathematical claims
in the caption remain model-authored and are not validated.

Brackets must isolate the intended crossing on a continuous branch, inside both
the panel and referenced curve domains. Endpoint residuals must have opposite
signs, or exactly one endpoint must already meet the tolerance. Bisection uses
at most 128 midpoint evaluations and accepts only evaluated points satisfying
`abs(f(x)-level) <= 1e-10 * max(1, abs(level))`. Nonfinite evaluations, ambiguous
matching endpoints, exhausted work or floating-point precision failures produce
field-specific errors advising a tighter continuous bracket. A pole's sign
change alone is insufficient. This does not prove uniqueness/continuity, find
tangencies, or guarantee relative accuracy for levels below the tolerance floor.

Computed kinds cannot supply y or reference measured-point curves. They require
finite coordinates and positive log coordinates. Use `{kind: "note", x, y,
label}` for explanatory text without a data-point marker. Existing `{x, y, label}`
and explicit `kind: "point"` inputs retain their coordinate marker behavior.
Resolved coordinates seed sampling and drive marker, leader and layout geometry.
Each panel accepts at most 40 annotations.

To compare an explicit input correction, append a separately labeled variant:

```sh
node --import tsx scripts/plot-render-review.ts \
  --run data/plot-benchmark/2026-11-12T15-27-19-556Z-99c65385 \
  --out data/plot-render-review/formulas-sampling-v1 \
  --variants tests/fixtures/plot-sampling/review-variants.json
```

Choose a new output directory each time. The variants file has `schemaVersion: 1`
and a `variants` array of `{ caseId, attempt, plotIndex, input, reason }` records.
Indexes are one-based within the saved plot jobs. Duplicate or missing targets
fail preflight. Original render pairs remain, and variant pairs are appended with
their reason. `results.json` records original-input hashes and input provenance.
The example replaces case 09's model-generated approximation points with the
stated analytic function on two branch domains; it never rewrites source evidence
or claims that the revised input is the original model output.

### Live model benchmark

Install dependencies with `npm install`. Use Node with `node:sqlite` support; the
package command enables the experimental SQLite flag for Node 22. The app's Pi
dependencies require Node 22.19 or newer. The manifest records the actual runtime.

```sh
npm run benchmark:plot -- \
  --profile-dir "$HOME/Library/Application Support/com.hwacha.learnharness-dev" \
  --model deepseek:deepseek-flash --thinking high
```

The profile path is explicit because installed and development app settings can
differ. Without `--model`/`--thinking`, the benchmark uses the profile's current
strong slot. To compare another model, change the command, not the fixtures:

```sh
npm run benchmark:plot -- \
  --profile-dir "$HOME/Library/Application Support/com.hwacha.learnharness-dev" \
  --model openrouter:vendor/model-id --thinking medium --repetitions 3
```

An override changes only the benchmark conversation model; the source profile
and its background model configuration are preserved. API credentials resolve
through the app's normal environment/profile precedence. The selected provider
must be available in the Node runtime. Desktop subscription connections requiring
native IPC cannot be made available by supplying only their model ID; preflight
refuses unavailable connections instead of substituting another provider.

Options:

| Option                          | Meaning                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `--profile-dir <directory>`     | Required for live runs; contains `learnharness.db` and optional `auth.json`                      |
| `--model <provider:model-id>`   | Override conversation model, preserving colons inside the model ID                               |
| `--thinking <level>`            | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; app engine clamps to model support |
| `--case <id>`                   | Select a case; repeat to select several                                                          |
| `--cases <file>`                | Alternate versioned fixture, default `tests/fixtures/plot-benchmark/cases.json`                  |
| `--repetitions <n>`             | Positive integer, default 1; each attempt gets a fresh child process                             |
| `--timeout-ms <n>`              | Positive integer, default 120000; parent termination after 5 seconds of additional grace         |
| `--out <new-directory>`         | Output directory; existing directories are refused                                               |
| `--report-only <run-directory>` | Regenerate a report from saved evidence, without model calls; used alone                         |

By default results go to `data/plot-benchmark/<timestamp>-<suffix>/`, which is
gitignored. Custom output directories get a local `.gitignore`. Each run saves:

- `manifest.json`: model, requested/resolved thinking, profile, runtime,
  dependency versions, revision/dirty-tree hashes, and case/settings hashes.
- `cases.json`, `settings.json`, `prompt-overrides.json`: public configuration
  snapshots. SHA-256 values use compact `JSON.stringify` serialization.
- `results.json`, `review.json`, `index.html`: structured results, manual review,
  and a static report. Reports update after each attempt.
- `<case>/attempt-<n>/`: actual model request bodies, turn events, conversation,
  job records, projected view, result checkpoint, diagnostics and child options.
  `artifacts/` retains SVGs and PNG previews, including undelivered results.

Credentials and request headers are not saved. A profile snapshot is frozen for
the suite; credentials are read in each child through the app auth path.

## Review

Open the printed `index.html` path in a browser. For each attempt, compare the
figure and transcript with the independent requirements and numerical landmarks.
The fixtures include straightforward functions, composition, multiple curves,
measured data, log axes, Bode magnitude/phase, annotations, a discontinuity, a
narrow peak, missing information and an incompatible logarithmic domain.

The fixed 801-point renderer may miss the narrow peak or connect a discontinuity.
Those are deliberate challenge cases. No plotting or prompt changes are made to
improve this initial baseline. Cases 05 and 10 are held out from future tuning;
their initial baseline evidence is still retained and shown.

Edit `review.json` to record your conclusions. Keys are `<case-id>/attempt-<n>`.
`correctness` and `readability` accept `pending`, `pass`, or `fail`; `misleading`
accepts `pending`, `yes`, or `no`. `notes` is free text. For clarification cases,
use correctness to record whether the question or limitation was justified.
Regenerate the report without inference:

```sh
npm run benchmark:plot -- --report-only data/plot-benchmark/<run-directory>
```

Regeneration preserves review entries and merges them into the top-level report
and `results.json`. Raw per-attempt evidence is retained.

## Interpreting outcomes

`artifact-delivered` requires a plot job with a nonempty SVG, its saved delivery
marker and the corresponding artifact in the UI projection. It also requires
settled turns and no computing jobs. It does not establish numerical correctness
or readability. All plot jobs must satisfy delivery; an earlier failed job remains
a `job-failed` outcome even if the teacher subsequently produced another artifact.

`awaiting-input` records an unanswered question. It is a candidate expected
outcome for ambiguity cases, whose relevance you review. For ordinary plot cases,
it exposes unnecessary clarification or a result blocked behind a question.
The harness does not fabricate an answer or dismiss the question to force delivery.

`response-only` means the teacher settled without a job. `job-failed`, `timed-out`
and `infrastructure-failed` retain errors and partial evidence. A completed but
undelivered job remains distinguishable from a successfully delivered plot.

Provider request rejections use the `infrastructure-failed` outcome bucket, but
the failure stage distinguishes known defects: an invalid declared tool schema
is an `invocation` failure. Report generation applies this classification to
saved error evidence, retaining raw attempt results unchanged. `analysis.json`
records the classification version and stage counts.

Exit status 0 means every attempt has an expected observable candidate: a
delivered artifact for a plot request, or a settled response/question for an
ambiguity request. Status 1 means an unexpected outcome or timeout. Status 2
means preflight or infrastructure failure. A zero exit status does not approve
the figures. Report regeneration returns 0 if successful, independently of the
saved benchmark outcomes.

Usage is preserved per model response where available. Missing counters are null.
Catalog-derived costs are labeled estimates; provider-reported costs are labeled
accordingly. A killed, errored, unaccounted request or background model call makes
the total incomplete/unknown rather than zero. Native provider retries are
preserved and visible as requests; the benchmark adds no automatic retries.

Timings for dispatch, job completion and saved delivery are sampled observations
at roughly 100 ms intervals and include checkpoint/rendering overhead. Total
latency includes child startup. Request payloads preserve actual system prompts,
history and tool declarations. The conversation is authoritative when a very
short wake stream is missed.

The initial context is a synthetic, schema-valid completed probe, marking the
teacher boundary without plot parameters or expected answers. The benchmark
evaluates the teacher at that boundary, not a complete onboarding conversation.
Node uses memory storage, so saved-delivery assertions exercise application
semantics without testing SQLite crash durability. One trial per case establishes
a baseline, not model variability. Compare identical case-set/configuration hashes
and repeated trials before drawing conclusions about regressions.

## Offline verification

```sh
npm exec -- prettier --check scripts/plot-benchmark.ts scripts/plot-benchmark tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/fixtures/plot-benchmark/cases.json
npm exec -- eslint --no-ignore scripts/plot-benchmark.ts scripts/plot-benchmark tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts
npm run typecheck
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/plot.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending.test.ts
```

The flow tests close the HTTP transport with scripted OpenAI-compatible streams;
they exercise production model serialization, teacher construction, dispatch,
rendering and delivery without external calls. There is no scripted-model mode
in the live benchmark CLI.
