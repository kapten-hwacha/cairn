# Headless plotting benchmark implementation plan

Status: approved for execution. The user additionally requires easy model changes:
`--model provider:model-id` and `--thinking <level>` override only the benchmark
conversation configuration. Omitting them inherits the selected profile. The
first baseline explicitly selects `deepseek:deepseek-flash` with high thinking.

## Agreed scope

- Headless only. Exercise the real teacher, plot dispatch, background runner, and session delivery; desktop UI automation is outside scope.
- Use the development app profile, currently `deepseek:deepseek-flash` with requested thinking level `high`. Snapshot its current settings at run start rather than maintaining separate model defaults.
- An ambiguity case ends at the first substantive clarification or explanation of the conflict. Do not fabricate learner answers.
- The user reviews mathematical correctness and visual readability. No vision judge or model-based grader.
- Establish a baseline before changing plotting behavior. Preserve all existing uncommitted work.

## Repository findings

The handoff's storage description is outdated. Current desktop adapters use SQLite, while Node uses `src/store/memory-backend.ts`. The development profile database is `/Users/hwacha/Library/Application Support/com.hwacha.learnharness-dev/learnharness.db`; settings are the `settings` entry in `kv_documents`, and prompt overrides are in `prompt_overrides`. Credentials are in the sibling `auth.json`. Legacy `data/settings.json` files must not select the benchmark configuration.

`src/server/chat-handler.ts` builds the production teacher and wires `createJobRunner` to `deliverJobResult`. A successful, matching `probe_done` call/result selects the teacher. Worker completion, accepted delivery in the saved conversation, and an artifact in `projectView` are separate observations. Node's in-memory acceptance tests application delivery semantics, not SQLite crash durability.

At planning time Node was v22.5.1. The user subsequently installed Homebrew Node v26.13.1, which is used for the live baseline. Use the built-in `node:sqlite` read-only database option to load the selected profile. No SQLite package or Python runtime dependency is needed.

## Proposed files and interfaces

Create these files:

| Path | Responsibility |
| --- | --- |
| `scripts/plot-benchmark.ts` | CLI, profile snapshot, sequential child processes, deadlines, final report |
| `scripts/plot-benchmark/contracts.ts` | Validated fixture/config/result contracts and schema version `1` |
| `scripts/plot-benchmark/profile.ts` | Read-only SQLite settings/override loader; credentials remain transient |
| `scripts/plot-benchmark/case-runner.ts` | Boot isolated stores, seed teacher session, invoke actual handler, collect live and saved evidence |
| `scripts/plot-benchmark/report.ts` | Escaped, static HTML report plus structured JSON; no external assets or scripts |
| `scripts/plot-benchmark/io.ts` | Atomic JSON checkpoints and content hashing |
| `scripts/plot-benchmark/process.ts` | Child process supervision and independent deadline enforcement |
| `tests/fixtures/plot-benchmark/cases.json` | Versioned natural-language cases and independent review expectations |
| `tests/plot-benchmark.test.ts` | CLI/contracts/profile/report/timeout tests with temporary data and no network |
| `tests/plot-benchmark-flow.test.ts` | Scripted-model tests of real dispatch, runner, saved delivery and projection |
| `docs/plot-benchmark.md` | Running, reviewing, repeating and comparing the benchmark |

Modify `package.json` to add `"benchmark:plot": "node --experimental-sqlite --import tsx scripts/plot-benchmark.ts"`. Add Prettier 3 as a development dependency, updating `package-lock.json`, because the repository has no installed formatter. Existing production plotting code and prompts are outside this change.

Public harness functions:

- `loadProfile(profileDir: string): Promise<ProfileSnapshot>` reads settings, prompt overrides and credentials; it never writes to the profile. `ProfileSnapshot` contains `settings: UserSettings`, `promptOverrides: Record<string, string>`, and transient `authContent: string | null`. The saved public snapshot omits `authContent`.
- `runCase(options: CaseRunOptions): Promise<CaseResult>` runs one fixture using the profile snapshot and writes incremental evidence to its attempt directory. `CaseRunOptions` contains `case: BenchmarkCase`, `attempt: number`, `settings: UserSettings`, `promptOverrides: Record<string, string>`, `profileDir: string`, `outputDir: string`, and `timeoutMs: number`. The child reads credentials directly from the selected profile path; credentials do not travel through command-line arguments or result files.
- `writeReport(runDir: string, manifest: RunManifest, results: CaseResult[]): Promise<void>` writes `results.json` and `index.html`. Failed and missing attempts remain in the denominator.

Fixtures use `{ schemaVersion: 1, caseSetVersion: "plot-v1", cases: BenchmarkCase[] }`. Each case has `id`, `partition: "development" | "held-out"`, `prompt`, `expectedOutcome: "plot" | "clarification-or-limitation"`, and `review: { requirements: string[], landmarks: { description: string, x: number, y: number, tolerance: number }[], misleadingFailures: string[] }`. Landmark tolerances are absolute in the displayed axis units; they are review criteria, not pixel snapshot tolerances. A JSON/TypeScript validator refuses duplicate IDs, empty prompts, invalid landmarks and unknown schema versions before model calls.

Each `CaseResult` contains `schemaVersion`, `caseId`, `attempt`, `outcome`, `failureStage`, `evidence`, `timingsMs`, `usage`, `cost`, and `review`. Outcomes are `artifact-delivered`, `response-only`, `awaiting-input`, `job-failed`, `timed-out`, or `infrastructure-failed`. `failureStage` is null or one of `interpretation`, `invocation`, `execution`, `rendering`, `delivery`, `infrastructure`; classifications inferred from observable evidence carry a reason, and ambiguous causes stay unclassified. `review` starts as `{ correctness: "pending", readability: "pending", misleading: "pending", notes: "" }`; correctness/readability accept `pending`, `pass` or `fail`, and misleading accepts `pending`, `yes` or `no`. No automatic outcome means that the plot is mathematically or visually correct. Clarification relevance is also for human review.

`evidence` lists relative file paths and observed flags: plot invocation, saved job outcome, saved result marker, projected nonempty SVG artifact, and post-delivery teacher text. `timingsMs` records first response, dispatch, computation completion, saved delivery and total elapsed time, using a monotonic clock; absent events are null. Usage preserves per-call records where available and null for missing counters. Cost records USD, source (`provider` or `catalog-estimate`), and completeness; unknown or incomplete totals are not reported as zero or complete totals.

`RunManifest` records schema/case-set versions, case-set SHA-256, revision, tracked diff hash, dirty status, hashes of relevant untracked plotting/prompt files, Node/platform/architecture, dependency versions, selected profile path, public settings snapshot/hash, requested/resolved model and thinking level, effective prompt evidence, start/end timestamps, attempts and timeout. It contains no credential values or HTTP headers.

## Proposed first case set

The fixture stores these exact prompts and expands the expectations below into its review fields. Cases 05 and 10 are held out from later tuning; the initial unchanged baseline runs all twelve.

| ID | Natural-language request | Independent expectations |
| --- | --- | --- |
| 01-sine | Plot sin(x) from -pi to pi. Label the horizontal axis x (rad) and the vertical axis sin(x). | Linear axes; zeros at -pi, 0, pi; extrema at ±pi/2 with values ±1; landmark tolerance 0.02. |
| 02-quadratic | Plot y = x^2 - 4 from x = -3 to 3. Label the axes x and y. | Roots ±2; vertex (0, -4); endpoints y=5; tolerance 0.05. |
| 03-composed | Plot y = exp(-x/2)*sin(3*x) from x = 0 to 6. Label the axes x (s) and y (V). | Decaying oscillation; y(0)=0, y(pi/6)=0.7696654125, y(pi/2)=-0.4559381278; tolerance 0.02. |
| 04-multiple | Plot sin(x) and cos(x) together from 0 to 2*pi, using distinct curves and a legend. Label x in radians and y as amplitude. | Both curves identified; at x=0 values 0 and 1; at pi/2 values 1 and 0; tolerance 0.02. |
| 05-points | Plot these measured samples as one curve: time (s), voltage (V): (0,0), (1,2), (2,1), (3,3), (4,2). Preserve all five measurements. | All five data points preserved, correct order and units; value tolerance 0.001. |
| 06-log | Plot y = x^2 for x from 0.1 to 100, with logarithmic scales on both axes. Label the axes x and y. | Both log scales; points (0.1,0.01), (1,1), (10,100), (100,10000); absolute tolerance max(0.001, 1% of each expected y). |
| 07-bode | Show the Bode magnitude and phase plots of H(jf) = 1/(1+j*f/1000), from 10 Hz to 100 kHz. Use a logarithmic frequency axis, magnitude in dB, and phase in degrees. | Two panels; same log frequency range; f=1000: -3.0102999566 dB and -45 degrees; f=10000: -20.0432137378 dB and -84.2894068625 degrees; tolerances 0.1 dB/0.5 degrees. |
| 08-annotation | Plot y = x^2 from x = -2 to 2 and annotate its minimum at (0,0) with the text minimum. Label the axes x and y. | Parabola, correct domain, visible annotation attached to (0,0); tolerance 0.02. |
| 09-discontinuity | Plot y = 1/(x-0.123) from x = -1 to 1, showing its vertical asymptote without drawing a connecting line across the discontinuity. Label the axes x and y. | Discontinuity at 0.123; branches remain separate; y(-0.877)=-1 and y(1)=1.1402508552; tolerance 0.02; a stated renderer limitation is useful evidence but does not count as a delivered faithful plot. |
| 10-narrow-peak | Plot y = exp(-((x-0.1234)/0.0001)^2) from x = 0 to 1. Make the narrow peak at x = 0.1234 visible. Label the axes x and y. | Peak reaches 1 at 0.1234 (tolerance 0.05); preserve requested overall domain; show detail if needed; a flat curve presented as faithful is misleading. |
| 11-missing | Plot the Bode response of my low-pass filter. | Ask for transfer function or enough circuit/filter parameters; do not invent order or cutoff. End at first substantive clarification. |
| 12-conflict | Plot y = x on a logarithmic x-axis from x = -10 to 10, keeping all the negative x values. | Explain incompatibility and ask for/offer a valid alternative; do not silently discard negatives or relabel a linear axis as log. End at first substantive clarification or limitation. |

## Execution and failure handling

1. Validate CLI and fixtures; read a consistent public settings/prompt snapshot from the development SQLite database in a read-only transaction. Apply explicit `--model`/`--thinking` overrides to the benchmark snapshot only; otherwise inherit the profile. Resolve and validate the selected model, and record requested/resolved settings. The first baseline pins DeepSeek Flash/high in its command. Missing credentials or model fail preflight without starting the case suite.
2. Run one fresh child process per case/attempt, sequentially. Bootstrap the existing Node memory stores with the captured settings and prompt overrides before dynamically importing the chat handler. Load the chosen profile's credentials into memory using the normal auth initialization path; do not save them. Point filesystem diagnostics and prompt fallback paths at the isolated attempt directory.
3. Create a new teaching chat with a successful synthetic `probe_done` tool pair, using the native message contracts and marking that seed as benchmark setup. The call arguments are `{ assessment: { strands: [{ strand: "Function and data plotting", assessment: "No learner-specific knowledge is supplied by this benchmark setup." }], summary: "Synthetic benchmark handoff to the teacher." } }`; its matching successful result has `details: { ok: true }` and the existing `PROBE_DONE_ACK_TEXT`. Use the resolved model identity and complete zero-usage fields for this synthetic assistant record; exclude setup from usage/timing calculations. This deliberately evaluates a request to a teacher at the post-probe boundary, not the onboarding/prober experience. Do not seed plot parameters, expected answers, or tool-selection instructions into the agent context.
4. Submit the fixture verbatim via `handleChatInput(chatId, { type: "text", text: case.prompt })` with its default production construction and runner wiring. Do not substitute an agent factory in live trials. Capture request JSON bodies at the outgoing fetch boundary without recording headers or altering the request. This retains the actual system prompt, history and tool declarations; a failed capture is an infrastructure limitation, never fabricated prompt evidence.
5. Drain the initial event stream and subscribe to later live turn handles when observed. Poll chat/job records every 100 ms; checkpoint changed records, their UI projection and extracted SVGs atomically. Capture initial and wake-turn output, all job kinds, available usage and attempt-local diagnostics. Saved records remain authoritative if a very short wake stream is missed.
6. End after settled delivery with a projected nonempty artifact and no remaining live turn/job; after a settled response without jobs; after an unanswered question blocks the session; or at the deadline. A clarification candidate in a plot case is `awaiting-input`, not an automatic pass. Preserve completed job SVGs even if session delivery is blocked. Invalid SVG rendering and failed jobs retain their evidence.
7. Default deadline: 120 seconds per case, including background delivery. On deadline, snapshot evidence, abort live turns/jobs through existing abort APIs, allow 5 seconds for settlement, then terminate the child if necessary. A parent watchdog enforces the bound even if the child event loop stalls. Every case has an initial result checkpoint; an abruptly killed child becomes `timed-out` or `infrastructure-failed` in the parent report. Do not retry benchmark attempts automatically. Preserve provider-native retry behavior and record observed requests.
8. Write an escaped static report containing each prompt, expected landmarks, outcome, timings, available usage/cost, transcript/tool/job evidence links, and all extracted SVGs embedded as images. Every quality verdict starts pending. Also write a blank `review.json` keyed by case/attempt so the user can keep notes; report generation preserves existing reviews and can be rerun without model calls.

## CLI and outputs

Initial live baseline:

```sh
npm run benchmark:plot -- --profile-dir "/Users/hwacha/Library/Application Support/com.hwacha.learnharness-dev" --repetitions 1
```

Options: `--profile-dir <dir>` (required for live runs), `--cases <fixture.json>` (defaults to the versioned fixture), `--case <id>` (repeatable selection), `--repetitions <positive integer>` (default 1), `--timeout-ms <positive integer>` (default 120000), `--out <new-directory>` (default `data/plot-benchmark/<UTC timestamp>-<random suffix>`), and `--report-only <existing-run-directory>` (no profile or model calls). Refuse an existing live output directory to avoid overwriting evidence. Unknown options, invalid values and unknown IDs fail before network access.

Output layout: `manifest.json`, `cases.json`, `settings.json` (public snapshot), `results.json`, `review.json`, `index.html`, plus `<case-id>/attempt-<n>/{result.json,events.jsonl,requests.jsonl,chat.json,jobs.json,view.json,artifacts/*.svg}`. Diagnostics stay inside the run directory. `data/` is already gitignored. Never save auth contents. A custom output directory receives a local `.gitignore` ignoring all generated contents.

Exit status: 0 when every attempt has an expected observable candidate outcome (delivered artifact for plot cases; response/awaiting-input for ambiguity cases), 1 for unexpected outcomes/timeouts, 2 for preflight or infrastructure failures. Human review remains pending independently of exit status; a run of 0 is not a correctness certification. Report sample counts, failure categories, per-case latency, aggregate cost completeness, and min/median/max across repetitions. Comparison initially means identical fixtures/configuration and side-by-side per-case results; no release gate or composite quality score.

## Implementation tasks and explicit verification

1. Implement contracts, fixture validation, CLI/preflight and read-only profile loading. Tests use a temporary SQLite database with settings/overrides, plus sentinel source records; assert source contents are unchanged, credentials are absent from output, SQLite settings win over stale JSON, unexpected models fail, and malformed CLI/fixtures produce no requests.
2. Implement isolated case lifecycle and evidence capture. Scripted-model tests must drive the real teacher tool, real deterministic plot renderer, real job runner and real delivery registry; assert that a successful job without a saved marker/projected artifact is not delivery success. Cover delivery during a live turn and idle wake, pending question, renderer error, provider error, missing usage, timeout with partial artifact, and hard child termination. Use provider-local faux registrations only in tests; do not add a fake-engine mode to live CLI.
3. Implement report/review preservation. Assert all cases including killed attempts appear; HTML escapes model text and fixture strings; SVGs are displayed through image elements; unknown cost stays unknown; pending review cannot become pass automatically; report-only never starts inference.
4. Add package command, formatter dependency and usage documentation. Run format, lint and type checks, fixing issues in changed code. Preserve unrelated changes and report any pre-existing failures separately.
5. Run all twelve live cases once with DeepSeek Flash; retain and report successes, failures and partial evidence. Do not tune renderer/prompts or repeat failed live cases as part of baseline setup. Deliver the local report path for the user's review.

Commands (after implementation):

```sh
npm exec -- prettier --write scripts/plot-benchmark.ts scripts/plot-benchmark tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/fixtures/plot-benchmark/cases.json
npm exec -- eslint --no-ignore --fix scripts/plot-benchmark.ts scripts/plot-benchmark tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts
npm exec -- prettier --check scripts/plot-benchmark.ts scripts/plot-benchmark tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/fixtures/plot-benchmark/cases.json
npm run typecheck
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/plot.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending.test.ts
npm run benchmark:plot -- --profile-dir "/Users/hwacha/Library/Application Support/com.hwacha.learnharness-dev" --repetitions 1
```

Passing checks establish harness behavior and observable delivery. The baseline report supplies artifacts and independent expectations for the user's numerical/visual review. It does not establish platform UI behavior, storage crash recovery, model stability from one trial, or visual correctness before review.

## Follow-up: DeepSeek domain-schema compatibility

The first live run (`data/plot-benchmark/2026-11-12T15-12-40-394Z-00a8158b`)
failed all twelve requests before inference. DeepSeek rejected the plot tool's
tuple-style array of schemas in `items`. The user authorized continuing with
the schema fix, regression checks and an identical twelve-case rerun.

- Modify `src/agent/tools/jobs.ts`: reuse a numeric array schema with
  `items: { type: "number" }`, `minItems: 2`, and `maxItems: 2` for required
  `xDomain` and optional panel `yDomain`. Use TypeBox's `Unsafe` static-type
  override to retain the existing `[number, number]` contract; runtime
  validation still enforces exactly two numeric entries. Other inputs,
  prompts, dispatch, renderer and source profile remain unchanged.
- Create `tests/plot-tool-schema.test.ts`: check both domain schemas after
  JSON serialization; validate valid domains and optional omitted `yDomain`
  through Pi's actual argument validator; reject empty, short, long and
  nonnumeric domains on both axes.
- Modify `tests/plot-benchmark-flow.test.ts`: inspect every captured production
  DeepSeek request in the successful plot scenario and require the compatible
  schema on both axes. This catches regressions at the SDK serialization boundary.
- Preserve the first report; run the same fixtures once with DeepSeek Flash/high
  into a fresh output directory. Report delivery, clarification and failures
  separately; numerical and visual judgments remain the user's review.

Verification commands:

```sh
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-tool-schema.test.ts tests/plot-benchmark-flow.test.ts
npm exec -- prettier --write --use-tabs src/agent/tools/jobs.ts
npm exec -- prettier --write tests/plot-tool-schema.test.ts tests/plot-benchmark-flow.test.ts
npm exec -- eslint --fix src/agent/tools/jobs.ts tests/plot-tool-schema.test.ts tests/plot-benchmark-flow.test.ts
npm exec -- prettier --check --use-tabs src/agent/tools/jobs.ts
npm exec -- prettier --check tests/plot-tool-schema.test.ts tests/plot-benchmark-flow.test.ts
npm run typecheck
NODE_ENV=test node --experimental-sqlite --import tsx --test tests/plot-tool-schema.test.ts tests/plot-benchmark.test.ts tests/plot-benchmark-flow.test.ts tests/plot.test.ts tests/demos.test.tsx tests/jobs.test.ts tests/pending.test.ts
git diff --check
npm run benchmark:plot -- --profile-dir "/Users/hwacha/Library/Application Support/com.hwacha.learnharness-dev" --model deepseek:deepseek-flash --thinking high --repetitions 1
```

Follow-up verification completed on 2026-11-12: the two schema regressions
failed before the fix and passed afterward. All 135 related tests (26 suites),
ESLint, Prettier, TypeScript and `git diff --check` passed.

The fresh report is
`data/plot-benchmark/2026-11-12T15-27-19-556Z-99c65385/index.html`.
Its fixtures, public settings, prompt overrides, dependencies and runtime match
the original baseline. There were no schema rejections: 42 captured plot-tool
declarations used the compatible schema across 43 total requests. Outcomes were
9 `artifact-delivered`, 2 `awaiting-input`, and 1 `timed-out`; the benchmark
therefore exited 1. Twelve SVG/PNG artifacts were retained, including two
delivered plots in the narrow-peak timeout case and one in the conflicting-axis
clarification case. The narrow-peak case also dispatched a demo job that remained
pending at the 120-second deadline and was cancelled. No timeout tuning or live
retries were performed. Cost accounting remains incomplete; all quality reviews
remain pending for the user. The original report was preserved.
