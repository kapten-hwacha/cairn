# Plotting benchmark: handoff

## Goal and context

Build an evaluation pipeline for the **complete user experience**: a user requests a plot in natural language, the real teaching agent interprets the request, dispatches a background plot job, and the user receives a useful, correct, readable result. Measure failures across that chain, not just whether an SVG was produced. The user wants a document to hand to the next agent; implementation is not yet approved.

The current working tree contains uncommitted plotting work and other changes. Preserve them and inspect the actual tree before proceeding; do not assume everything is committed. Earlier figure-agent failures motivated a more reliable plotting path. The existing visual maker remains separate and has had image-processing issues; avoid attributing every failure to the new plot renderer.

## Project background

LearnHarness is an AI teaching application. A learner states what they want to understand; the system probes their current understanding, plans a lesson, teaches interactively, and offers practice. Conversations and a knowledge graph persist across sessions. Plots are teaching artifacts: their value depends on whether they accurately illustrate the concept in the learner's context, not simply on whether they look attractive. See `README.md`, `docs/teaching-methodology.md`, and `docs/architecture.md` for the broader product and architecture.

The teaching agent runs with model and tool configuration and can dispatch background work while the conversation continues. Background job completion and delivery are distinct: an outcome can be saved before it is delivered back to the session, and delivery may wait for an eligible point in the conversation. The interface projects saved conversation and job records into chat and artifact cards. A meaningful benchmark should therefore observe the learner-facing result and any failure or delay in delivery, not just the job's status.

The primary application architecture is a React client and dedicated Web Worker backend inside a Tauri desktop shell; the repository also maintains a legacy Next.js web runtime. The target platform matters because runtime APIs and rendering behavior differ, especially between desktop WebKit, browser workers and a Node-based harness. iPadOS support is also a project concern, but prior verification of the new plotting path did not establish that it works there. Runtime-specific conclusions need runtime-specific evidence.

The source is organized around `src/agent/` for agents and tools, `src/core/` for contracts and domain logic, `src/server/` for service orchestration, `src/worker/` for the desktop worker, `components/` for presentation, and `src-tauri/` for the native shell. Conversations and job records are persisted locally; model requests may still use external providers. A benchmark should use isolated test data and avoid contaminating real learner sessions.

## Why the new plotting path exists

The user encountered repeated failures with background figure generation and discussed whether a different approach would be more reliable. They chose a usable background plotting tool based on Vega-Lite first, while retaining the existing visual maker for other visual tasks. The agreed initial interface supports both numeric point data and expressions built from common mathematical functions and arithmetic; it does not require the plotting agent to write and execute arbitrary Python. The current plot job uses deterministic rendering rather than a separate model-based visual inspection step. A benchmark can evaluate whether that choice meets the user's needs without assuming visual quality is already solved.

Earlier investigation found desktop runtime problems around `Buffer` and image processing in the older visual path; fixes and related changes are present in the working tree, but the separate Photon image-decoding issue was not established as fixed. Avoid conflating those defects with Vega plotting. The user also requested a DMG, which was built successfully; a Next.js build attempt in the agent's restricted environment encountered port permissions, while the user reported that it ran in their terminal. The DMG build and Next.js build use different paths. Neither result is an end-to-end plotting benchmark.

## Current implementation to investigate

- `src/core/contracts/jobs.ts` defines the `plot` job and its input: an x label, linear or log x scale and domain, and panels with y labels, scales, curves, optional domains and annotations. Curves provide an expression or numeric points.
- `src/agent/plot.ts` evaluates a restricted mathematical expression language, samples expression curves, and uses Vega-Lite/Vega to produce SVG. Sampling currently uses 801 points; narrow features and discontinuities between samples can be missed.
- `src/agent/tools/jobs.ts`, `src/agent/tools.ts`, and `src/agent/subagents/runner.ts` connect tool calls to background execution; `src/agent/prompts/teacher/50-demos.md` instructs the teacher on use. Inspect the implementation to establish the real execution and delivery path before choosing an entry point.
- `tests/plot.test.ts`, `tests/demos.test.tsx`, `tests/jobs.test.ts`, and `tests/pending.test.ts` provide existing checks, not an end-to-end benchmark. Previous verification included a headless Chrome worker smoke test, but not a live model-driven run in the packaged macOS or iPad app.
- The desktop build uses Tauri and Vite; Next.js provides a separate web path. A successful build or renderer-only test does not establish the quality of the actual agent experience.

## Proposed evaluation design

1. **Run realistic user requests through the real agent and background job path.** Capture the actual prompt, model and configuration, tool calls and inputs, job status/errors, final response, produced artifact, timings, and available token usage and cost. Record missing usage as unknown. Define a timeout and retain failures and partial results. Avoid bypassing the agent by supplying the plot input directly for the primary benchmark.
2. **Curate cases with independent expectations.** Include elementary and combined functions, multiple curves, explicit numeric data, log axes and a Bode plot, annotations, a discontinuity, and a narrow peak. Specify expected landmarks, ranges, labels and units where applicable. Include both ordinary requests and requests with missing or conflicting information; distinguish a justified clarification or limitation from a misleading plot. Keep some cases held out from tuning.
3. **Score dimensions separately.** Check completion and artifact delivery; correctness of interpretation, units, scales and numerical landmarks; and visual readability, including clipping, labels, legend and visible features. Use deterministic checks against independent reference values where feasible. Inspect rendered output as well as input/specification: valid inputs alone do not prove the chart is legible or faithful. Define explicit case-level pass/fail criteria and severity for misleading results.
4. **Add calibrated visual assessment where useful.** Human review is the reference for ambiguous visual judgments. A vision-model judge can assist once a rubric and human-labeled examples exist; record judge disagreement and avoid treating its score as ground truth. Decide how blind review and adjudication will work. Do not rely on pixel-perfect snapshots alone, as fonts and renderers can vary.
5. **Make runs reproducible and comparable.** Record revision and dirty-tree state, case-set version, runtime/platform, model/provider and settings, timestamps, attempt number and judge version. Save artifacts and structured results in a location chosen during planning. Compare the same cases and conditions against a baseline; run repeated trials to expose model variability. Report sample size, per-case outcomes, failure categories, latency, cost, uncertainty and limitations rather than one aggregate score.
6. **Retain diagnostic layers.** Tool-only checks can isolate numerical/rendering defects, but report them separately from end-to-end outcomes. Categorize failures by interpretation, tool invocation, job execution, rendering, delivery and evaluation infrastructure, while retaining evidence for each classification.

## Decisions for the user before implementation

- Which runtime is the first target: the actual Tauri desktop app, a headless invocation of the same agent and worker, or both? A headless harness is easier to automate, but must not be presented as proof of the packaged app experience.
- Which provider/model and budget should be used for live trials, and are external model and vision-judge calls authorized? Establish how credentials and potentially sensitive prompts/artifacts are handled.
- What size of initial case set and number of repetitions are acceptable, and what constitutes a release-blocking regression?
- Should visual judgments initially be human-only or include a calibrated model judge? Decide how review results are stored and who resolves disagreements.
- Agree on fixture/result locations, exact data contracts, command-line interface, and whether the benchmark is manual, local automation, or CI. Generated results may contain model output and should not be committed by default without an explicit decision.

## Suggested next steps

Inspect the real agent entry points, job persistence/delivery, test infrastructure, runtime constraints and existing model configuration. Present a concrete plan with exact file paths, fixture and result schemas, commands, failure handling, representative cases and validation before implementing, as required by the project's instructions. Establish a baseline before changing the plotting system, then run the agreed suite and report all failures, including infrastructure failures. Do not claim numerical or visual correctness solely because a job completed.
