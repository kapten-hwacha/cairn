import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Resvg } from "@resvg/resvg-js";
import type { ChatRecord, JobRecord } from "../../src/core/contracts.ts";
import type { LhMessage } from "../../src/core/native-messages.ts";
import { hasUnresolvedQuestion } from "../../src/core/native-messages.ts";
import { projectView } from "../../src/core/view.ts";
import type { LhViewMessage } from "../../src/core/view.ts";
import {
  initialResult,
  classifyFailureStage,
  type CaseResult,
  type CaseRunOptions,
} from "./contracts.ts";
import { appendJson, writeJson } from "./io.ts";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const svgOf = (value: unknown): string | null => {
  const svg = (value as { svg?: unknown } | null)?.svg;
  return typeof svg === "string" && svg.trim() ? svg : null;
};

/** Pure observation shared by checkpoints and tests: saved job != delivered artifact. */
export function observeDelivery(
  chat: ChatRecord,
  jobs: JobRecord[],
  view = projectView(chat.messages),
) {
  const plots = jobs.filter((j) => j.kind === "plot");
  const deliveries = plots.map((job) => {
    const marker = chat.messages.find(
      (m) =>
        m.id === `steer_${job.id}` &&
        m.role === "custom" &&
        m.customType === "subagent-steer",
    );
    const index = view.findIndex((m) => m.id === marker?.id);
    const artifact =
      index < 0
        ? undefined
        : view[index]?.parts.find((p) => {
            const data = p.data as
              { kind?: string; result?: unknown } | undefined;
            return (
              p.type === "data-subagent-artifact" &&
              data?.kind === "plot" &&
              !!svgOf(data.result)
            );
          });
    return {
      jobId: job.id,
      savedMarker: !!marker,
      projectedArtifact: !!artifact,
      delivered: !!marker && !!artifact && !!svgOf(job.result),
      postDeliveryTeacherText:
        index >= 0 &&
        view
          .slice(index + 1)
          .some(
            (m) =>
              m.role === "assistant" &&
              m.parts.some((p) => p.type === "text" && !!p.text?.trim()),
          ),
    };
  });
  return {
    plots,
    deliveries,
    allDelivered: plots.length > 0 && deliveries.every((d) => d.delivered),
  };
}

/** Keep unknown usage unknown, including calls killed before settlement. */
export function collectUsage(
  chat: ChatRecord,
  jobs: JobRecord[],
  requestCount: number,
): Pick<CaseResult, "usage" | "cost"> {
  const messages = chat.messages.filter(
    (m) => m.role === "assistant" && !m.id.startsWith("benchmark_seed_"),
  );
  const usage: CaseResult["usage"] = [];
  const costs: Array<{ value: number; provider: boolean }> = [];
  let missing = false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const u = message.usage;
    const known =
      !!u && (u.totalTokens > 0 || u.cost?.totalFromProvider === true);
    missing ||=
      !known ||
      message.stopReason === "error" ||
      message.stopReason === "aborted";
    const number = (n: number | undefined) =>
      known && typeof n === "number" && Number.isFinite(n) ? n : null;
    usage.push({
      messageId: message.id,
      model: `${message.provider}:${message.model}`,
      input: number(u?.input),
      output: number(u?.output),
      cacheRead: number(u?.cacheRead),
      cacheWrite: number(u?.cacheWrite),
      reasoning: number(u?.reasoning),
      raw: known ? u : null,
    });
    if (known && Number.isFinite(u.cost?.total))
      costs.push({
        value: u.cost.total,
        provider: u.cost.totalFromProvider === true,
      });
    else missing = true;
  }
  // Background model work is not part of the teacher's transcript. Keep its
  // per-call normalized counters and use the existing app pricing separately.
  for (const job of jobs) {
    if (job.kind === "plot") continue; // deterministic, no model calls
    if (!job.usage?.calls?.length) {
      missing = true;
      continue;
    }
    missing = true; // no provider/cost provenance survives normalized job usage
    job.usage.calls.forEach((u, index) =>
      usage.push({
        messageId: `${job.id}:${index}`,
        model: job.usage!.model,
        input: u.inputTokens ?? null,
        output: u.outputTokens ?? null,
        cacheRead: u.cacheReadTokens ?? null,
        cacheWrite: u.cacheWriteTokens ?? null,
        reasoning: u.reasoningTokens ?? null,
        raw: u,
      }),
    );
  }
  const complete =
    !missing &&
    requestCount > 0 &&
    usage.length === requestCount &&
    costs.length === usage.length;
  const sources = new Set(
    costs.map((c) => (c.provider ? "provider" : "catalog-estimate")),
  );
  return {
    usage,
    cost: {
      usd: complete ? costs.reduce((a, c) => a + c.value, 0) : null,
      source: costs.length
        ? sources.size === 1
          ? costs[0]!.provider
            ? "provider"
            : "catalog-estimate"
          : "mixed"
        : null,
      complete,
    },
  };
}

export async function runCase(options: CaseRunOptions): Promise<CaseResult> {
  const { configurePaths } = await import("../../config.ts");
  const output = path.resolve(options.outputDir);
  fs.mkdirSync(path.join(output, "artifacts"), { recursive: true });
  configurePaths({
    dataDir: path.join(output, "isolated-data"),
    authFile: path.join(output, "unused-auth.json"),
  });
  const memory = await import("../../src/store/memory-backend.ts");
  memory.resetMemoryStores();
  await memory.setMemoryKv("settings", options.settings);
  for (const [segment, content] of Object.entries(options.promptOverrides))
    await memory.writeMemoryPromptOverride(segment, content);
  const authFile = path.join(options.profileDir, "auth.json");
  const authContent = fs.existsSync(authFile)
    ? fs.readFileSync(authFile, "utf8")
    : null;
  memory.setMemoryAuthContent(authContent);
  const secrets: string[] = authContent
    ? Object.values(JSON.parse(authContent) as Record<string, unknown>).filter(
        (v): v is string => typeof v === "string" && v.length > 8,
      )
    : [];
  const scrub = (s: string) =>
    secrets.reduce(
      (out, secret) => out.split(secret).join("[credential removed]"),
      s,
    );
  const { replacePromptOverrideCache } =
    await import("../../src/agent/prompt-segments.ts");
  replacePromptOverrideCache(options.promptOverrides);
  const { initAuthEnv } = await import("../../src/server/keys.ts");
  await initAuthEnv();
  const { piEngineForSpec } = await import("../../src/agent/models.ts");
  const strong = options.settings.models?.strong;
  if (!strong?.model) throw new Error("No conversation model configured");
  const engine = piEngineForSpec({
    ...strong.model,
    thinkingLevel: strong.thinkingLevel,
  });
  const { PROBE_DONE_ACK_TEXT } =
    await import("../../src/core/contracts/probe.ts");
  const { chatStore } = await import("../../src/store/chats.ts");
  const { jobStore } = await import("../../src/store/jobs.ts");
  const { handleChatInput } = await import("../../src/server/chat-handler.ts");
  const { runningTurn, abortTurn, turnFailure } =
    await import("../../src/server/turn-runs.ts");
  const { isTurnRunning } = await import("../../src/server/turn-liveness.ts");
  const { abortJob, discardChatDeliveries } =
    await import("../../src/server/jobs.ts");
  const { abortExtraction } =
    await import("../../src/agent/subagents/extraction.ts");
  const chat = await chatStore.createChat(`Plot benchmark: ${options.case.id}`);
  const seed: LhMessage[] = [
    {
      id: "benchmark_seed_assistant",
      role: "assistant",
      api: engine.model.api,
      provider: engine.model.provider,
      model: engine.model.id,
      timestamp: Date.now(),
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content: [
        {
          type: "toolCall",
          id: "benchmark_seed_probe",
          name: "probe_done",
          arguments: {
            assessment: {
              strands: [
                {
                  strand: "Function and data plotting",
                  assessment:
                    "No learner-specific knowledge is supplied by this benchmark setup.",
                },
              ],
              summary: "Synthetic benchmark handoff to the teacher.",
            },
          },
        },
      ],
    },
    {
      id: "benchmark_seed_result",
      role: "toolResult",
      toolCallId: "benchmark_seed_probe",
      toolName: "probe_done",
      content: [{ type: "text", text: PROBE_DONE_ACK_TEXT }],
      details: { ok: true },
      isError: false,
      timestamp: Date.now(),
    },
  ];
  await chatStore.saveMessages(chat.id, seed);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const result = initialResult(options.case.id, options.attempt);
  const resultFile = path.join(output, "result.json");
  const originalFetch = globalThis.fetch;
  const streams: Promise<void>[] = [];
  const seenHandles = new Set<unknown>();
  let finishedAdmission = false;
  let admissionError: string | null = null;
  let streamError: string | null = null;
  let lastSaved = "";
  const rendered = new Map<string, string>();
  const renderErrors = new Map<string, string>();
  const recordEvent = (event: unknown) =>
    appendJson(path.join(output, "events.jsonl"), {
      elapsedMs: elapsed(),
      event: JSON.parse(scrub(JSON.stringify(event))),
    });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST") {
      try {
        const body: unknown = JSON.parse(await request.clone().text());
        if (body && typeof body === "object" && "model" in body) {
          appendJson(path.join(output, "requests.jsonl"), {
            elapsedMs: elapsed(),
            body: JSON.parse(scrub(JSON.stringify(body))),
          });
          result.evidence.requestCount++;
        }
      } catch {
        recordEvent({ type: "request-capture-failed" });
      }
    }
    return originalFetch(input, init);
  };
  const drain = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const parseLine = (line: string) => {
      if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") return;
      try {
        const event: unknown = JSON.parse(line.slice(6));
        recordEvent(event);
        const type = (event as { type?: string })?.type;
        if (
          (type === "message_start" || type === "message_update") &&
          result.timingsMs.firstResponse === null
        )
          result.timingsMs.firstResponse = elapsed();
      } catch {
        streamError = "Unable to parse a turn event";
      }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        lines.forEach(parseLine);
        if (done) {
          if (pending) parseLine(pending);
          break;
        }
      }
    } catch {
      streamError = "Turn event stream failed";
    } finally {
      reader.releaseLock();
    }
  };
  const checkpoint = async () => {
    const saved = await chatStore.getChat(chat.id);
    if (!saved) throw new Error("Benchmark chat disappeared");
    const jobs = await jobStore.listJobs(chat.id);
    const view = projectView(saved.messages);
    const observation = observeDelivery(saved, jobs, view);
    const e = result.evidence;
    e.plotInvoked = observation.plots.length > 0;
    e.jobCompleted = observation.plots.some((j) => j.status !== "running");
    e.savedMarker = observation.deliveries.some((d) => d.savedMarker);
    e.projectedArtifact = observation.deliveries.some(
      (d) => d.projectedArtifact,
    );
    e.postDeliveryTeacherText = observation.deliveries.some(
      (d) => d.postDeliveryTeacherText,
    );
    if (jobs.length && result.timingsMs.dispatch === null)
      result.timingsMs.dispatch = elapsed();
    if (e.jobCompleted && result.timingsMs.computation === null)
      result.timingsMs.computation = elapsed();
    if (e.savedMarker && result.timingsMs.delivery === null)
      result.timingsMs.delivery = elapsed();
    for (const job of jobs) {
      const svg = svgOf(job.result);
      if (!svg || rendered.get(job.id) === svg) continue;
      rendered.set(job.id, svg);
      fs.writeFileSync(
        path.join(output, "artifacts", `${job.id}.svg`),
        scrub(svg),
      );
      try {
        const png = new Resvg(svg, {
          background: "white",
          font: { loadSystemFonts: true },
        })
          .render()
          .asPng();
        fs.writeFileSync(path.join(output, "artifacts", `${job.id}.png`), png);
      } catch {
        renderErrors.set(job.id, "Produced SVG could not be rasterized");
      }
    }
    e.artifacts = jobs
      .filter((j) => svgOf(j.result))
      .map((j) => ({
        jobId: j.id,
        kind: j.kind,
        file: `artifacts/${j.id}.svg`,
        delivered: observation.deliveries.some(
          (d) => d.jobId === j.id && d.delivered,
        ),
      }));
    Object.assign(result, collectUsage(saved, jobs, e.requestCount));
    result.timingsMs.total = elapsed();
    const serialized = JSON.stringify([saved, jobs, view]);
    if (serialized !== lastSaved) {
      writeJson(
        path.join(output, "chat.json"),
        JSON.parse(scrub(JSON.stringify(saved))),
      );
      writeJson(
        path.join(output, "jobs.json"),
        JSON.parse(scrub(JSON.stringify(jobs))),
      );
      writeJson(
        path.join(output, "view.json"),
        JSON.parse(scrub(JSON.stringify(view))),
      );
      lastSaved = serialized;
    }
    e.files = [
      "events.jsonl",
      "requests.jsonl",
      "chat.json",
      "jobs.json",
      "view.json",
      "result.json",
    ].filter((file) => fs.existsSync(path.join(output, file)));
    writeJson(resultFile, result);
    return { saved, jobs, view, observation };
  };
  // Checkpoint exists before the first model request, including hard kills.
  writeJson(resultFile, result);
  const launch = handleChatInput(chat.id, {
    type: "text",
    text: options.case.prompt,
  })
    .then(async (response) => {
      if (!response.ok)
        admissionError = `Chat admission failed (${response.status}): ${scrub(await response.text())}`;
      else if (response.body) streams.push(drain(response.body));
      finishedAdmission = true;
    })
    .catch((error) => {
      admissionError = scrub(
        error instanceof Error ? error.message : "Chat admission failed",
      );
      finishedAdmission = true;
    });
  try {
    while (true) {
      const handle = runningTurn(chat.id);
      if (handle && !seenHandles.has(handle)) {
        seenHandles.add(handle);
        // The admission response already observes the initial handle.
        if (seenHandles.size > 1 || finishedAdmission)
          streams.push(drain(handle.subscribe()));
      }
      const { saved, jobs, observation } = await checkpoint();
      const live = isTurnRunning(chat.id) || !!runningTurn(chat.id);
      const computing = jobs.some((j) => j.status === "running");
      const failed = jobs.find((j) => j.status === "error");
      if (admissionError || turnFailure(chat.id)) {
        result.reason = admissionError ?? turnFailure(chat.id) ?? null;
        result.failureStage = admissionError ? "infrastructure" : null;
        result.outcome = admissionError
          ? "infrastructure-failed"
          : "response-only";
        break;
      }
      if (elapsed() >= options.timeoutMs) {
        result.outcome = "timed-out";
        result.failureStage =
          observation.plots.length && !observation.allDelivered
            ? "delivery"
            : null;
        result.reason = "Case deadline exceeded; partial evidence retained";
        abortTurn(chat.id);
        abortExtraction(chat.id);
        await Promise.all(
          jobs.filter((j) => j.status === "running").map((j) => abortJob(j.id)),
        );
        const settleUntil = performance.now() + 4_000;
        while (runningTurn(chat.id) && performance.now() < settleUntil) {
          await delay(50);
          await checkpoint();
        }
        break;
      }
      if (finishedAdmission && !live) {
        const modelError = saved.messages.find(
          (m) => m.role === "assistant" && m.stopReason === "error",
        );
        if (modelError?.role === "assistant") {
          result.outcome = "infrastructure-failed";
          result.failureStage = "infrastructure";
          result.reason = scrub(
            `Model request failed: ${modelError.errorMessage ?? "provider returned an error"}`,
          );
          result.failureStage = classifyFailureStage(result);
          break;
        }
        if (renderErrors.size) {
          result.outcome = "job-failed";
          result.failureStage = "rendering";
          result.reason = [...renderErrors.values()].join("; ");
          break;
        }
        if (failed && !computing) {
          result.outcome = "job-failed";
          result.failureStage = "execution";
          result.reason = failed.error ?? "Background job failed";
          break;
        }
        if (observation.allDelivered && !computing) {
          result.outcome = "artifact-delivered";
          result.failureStage = null;
          result.reason = null;
          break;
        }
        if (hasUnresolvedQuestion(saved.messages)) {
          result.outcome = "awaiting-input";
          result.failureStage =
            observation.plots.length && !observation.allDelivered
              ? "delivery"
              : null;
          result.reason =
            "Session stopped at an unanswered question; relevance requires review";
          break;
        }
        if (!jobs.length) {
          result.outcome = "response-only";
          result.failureStage = null;
          result.reason =
            "Teacher settled without dispatching a background job";
          break;
        }
      }
      await delay(100);
    }
    await checkpoint();
    if (streamError) {
      result.reason = [result.reason, streamError].filter(Boolean).join("; ");
    }
    if (!result.evidence.requestCount) {
      result.outcome = "infrastructure-failed";
      result.failureStage = "infrastructure";
      result.reason = [result.reason, "No outgoing model payload captured"]
        .filter(Boolean)
        .join("; ");
    }
    return result;
  } finally {
    abortTurn(chat.id);
    abortExtraction(chat.id);
    const jobs = await jobStore.listJobs(chat.id);
    await Promise.all(
      jobs.filter((j) => j.status === "running").map((j) => abortJob(j.id)),
    );
    discardChatDeliveries(chat.id);
    result.timingsMs.total = elapsed();
    writeJson(resultFile, result);
    globalThis.fetch = originalFetch;
    // Stream readers never gate the deadline; process isolation cleans up any
    // provider that ignores cancellation. All rejections are handled above.
    void launch;
    void streams;
  }
}

export function transcriptText(view: LhViewMessage[]): string {
  return view
    .map(
      (message) =>
        `${message.role}:\n${message.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")}`,
    )
    .join("\n\n");
}
