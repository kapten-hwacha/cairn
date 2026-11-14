import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  ChatRecord,
  JobRecord,
  PlotInput,
} from "../../src/core/contracts.ts";
import { buildSubagentSteer } from "../../src/core/contracts.ts";
import { projectView } from "../../src/core/view.ts";
import {
  runCase,
  observeDelivery,
  collectUsage,
} from "../../scripts/plot-benchmark/case-runner.ts";
import {
  caseSetSchema,
  type CaseRunOptions,
} from "../../scripts/plot-benchmark/contracts.ts";
import { readJson, writeJson } from "../../scripts/plot-benchmark/io.ts";

const cases = caseSetSchema.parse(
  readJson("tests/fixtures/plot-benchmark/cases.json"),
).cases;
const input: PlotInput = {
  xLabel: "x",
  xScale: "linear",
  xDomain: [-1, 1],
  panels: [
    {
      title: "Identity",
      yLabel: "y",
      yScale: "linear",
      curves: [
        { label: "y=x", expression: "x", xDomain: [-1, 1], sampleAt: [0.1234] },
      ],
    },
  ],
};
type Call = { name: string; arguments: unknown };
function sse(calls: Call[], usage = true): Response {
  const chunks = [
    {
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: calls.length
              ? "Here is the requested step."
              : "Notice the plotted curve and its axes.",
            ...(calls.length
              ? {
                  tool_calls: calls.map((c, index) => ({
                    index,
                    id: `call_${index}`,
                    type: "function",
                    function: {
                      name: c.name,
                      arguments: JSON.stringify(c.arguments),
                    },
                  })),
                }
              : {}),
          },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: calls.length ? "tool_calls" : "stop",
        },
      ],
    },
    ...(usage
      ? [
          {
            choices: [],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        ]
      : []),
  ];
  return new Response(
    chunks
      .map(
        (c) =>
          `data: ${JSON.stringify({ id: "test-completion", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", ...c })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function scenario(
  mode:
    | "plot"
    | "blocked"
    | "invalid"
    | "clarify"
    | "hang"
    | "provider-error"
    | "missing-usage"
    | "text",
  check: (
    options: CaseRunOptions,
    result: Awaited<ReturnType<typeof runCase>>,
  ) => Promise<void> | void,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-benchmark-flow-"));
  const original = globalThis.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only-deepseek-key";
  writeJson(path.join(dir, "auth.json"), {
    DEEPSEEK_API_KEY: "test-only-deepseek-key",
  });
  const options: CaseRunOptions = {
    case: cases[mode === "clarify" ? 10 : 0]!,
    attempt: 1,
    settings: {
      version: 1,
      models: {
        strong: {
          model: { provider: "deepseek", id: "deepseek-flash" },
          thinkingLevel: "high",
        },
      },
      graph: { enabled: false },
    },
    promptOverrides: {},
    profileDir: dir,
    outputDir: path.join(dir, "attempt"),
    timeoutMs: mode === "hang" ? 150 : 8_000,
  };
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    const current = ++count;
    if (mode === "hang")
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(new Error("aborted"));
        else
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
      });
    if (mode === "provider-error")
      return Response.json(
        {
          error: {
            message: "Provider refused test request",
            type: "invalid_request_error",
          },
        },
        { status: 401 },
      );
    if (current > 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return sse([]);
    }
    if (mode === "clarify")
      return sse([
        {
          name: "ask_user_question",
          arguments: {
            question: "What transfer function or cutoff does your filter have?",
          },
        },
      ]);
    if (mode === "text" || mode === "missing-usage")
      return sse([], mode !== "missing-usage");
    const plot = structuredClone(input);
    if (mode === "invalid") plot.xDomain = [2, -2];
    return sse([
      { name: "plot", arguments: plot },
      ...(mode === "blocked"
        ? [
            {
              name: "ask_user_question",
              arguments: { question: "Which part should we discuss?" },
            },
          ]
        : []),
    ]);
  };
  try {
    const result = await runCase(options);
    await check(options, result);
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("completed job requires both a saved marker and projected SVG to count as delivered", () => {
  const chat: ChatRecord = {
    id: "test",
    title: "",
    createdAt: "",
    updatedAt: "",
    messages: [],
  };
  const job: JobRecord = {
    id: "plot",
    chatId: chat.id,
    toolCallId: "call",
    kind: "plot",
    status: "done",
    activity: "finished",
    createdAt: "",
    updatedAt: "",
    result: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  };
  assert.equal(observeDelivery(chat, [job]).allDelivered, false);
  chat.messages = [buildSubagentSteer(job, job.result as { svg: string })];
  assert.equal(observeDelivery(chat, [job]).allDelivered, true);
  assert.equal(observeDelivery(chat, [job], []).allDelivered, false);
  assert.equal(collectUsage(chat, [job], 1).cost.usd, null);
});

test("real teacher handler dispatches, renders and delivers a plot with reproducible request evidence", async () => {
  await scenario("plot", (options, result) => {
    assert.equal(result.outcome, "artifact-delivered", JSON.stringify(result));
    assert.equal(result.evidence.savedMarker, true);
    assert.equal(result.evidence.projectedArtifact, true);
    assert.ok(result.evidence.requestCount >= 2);
    assert.equal(result.review.correctness, "pending");
    const artifact = result.evidence.artifacts[0]!;
    assert.ok(
      fs
        .readFileSync(path.join(options.outputDir, artifact.file), "utf8")
        .startsWith("<svg"),
    );
    assert.ok(
      fs.existsSync(
        path.join(options.outputDir, artifact.file.replace(/\.svg$/, ".png")),
      ),
    );
    const requests = fs.readFileSync(
      path.join(options.outputDir, "requests.jsonl"),
      "utf8",
    );
    assert.ok(requests.includes(options.case.prompt));
    assert.ok(requests.includes('"tools"'));
    assert.ok(!requests.includes("test-only-deepseek-key"));
    assert.ok(!requests.includes("misleadingFailures"));
    for (const line of requests.trim().split("\n")) {
      const request = JSON.parse(line);
      const plot = request.body.tools.find(
        (tool: { function: { name: string } }) => tool.function.name === "plot",
      );
      assert.ok(plot, "The production request must advertise the plot tool");
      const properties = plot.function.parameters.properties;
      for (const domain of [
        properties.xDomain,
        properties.panels.items.properties.xDomain,
        properties.panels.items.properties.yDomain,
        properties.panels.items.properties.curves.items.properties.xDomain,
      ]) {
        assert.deepEqual(domain.items, { type: "number" });
        assert.equal(domain.minItems, 2);
        assert.equal(domain.maxItems, 2);
      }
    }
    assert.equal(result.cost.complete, true);
    assert.equal(result.cost.source, "catalog-estimate");
  });
});

test("finished plot blocked behind a learner question preserves SVG but is not delivery success", async () => {
  await scenario("blocked", (_options, result) => {
    assert.equal(result.outcome, "awaiting-input", JSON.stringify(result));
    assert.ok(result.evidence.artifacts.length > 0);
    assert.equal(result.evidence.savedMarker, false);
    assert.equal(result.evidence.projectedArtifact, false);
    assert.equal(result.evidence.artifacts[0]!.delivered, false);
    assert.equal(result.failureStage, "delivery");
  });
});

test("renderer errors remain failed jobs rather than successful deliveries", async () => {
  await scenario("invalid", (_options, result) => {
    assert.equal(result.outcome, "job-failed", JSON.stringify(result));
    assert.equal(result.evidence.projectedArtifact, false);
    assert.equal(result.evidence.artifacts.length, 0);
  });
});

test("ambiguity stops at clarification without fabricating a learner answer", async () => {
  await scenario("clarify", (options, result) => {
    assert.equal(result.outcome, "awaiting-input", JSON.stringify(result));
    assert.equal(result.evidence.plotInvoked, false);
    const chat = readJson(
      path.join(options.outputDir, "chat.json"),
    ) as ChatRecord;
    assert.equal(chat.messages.filter((m) => m.role === "user").length, 1);
  });
});

test("missing provider usage stays unknown", async () => {
  await scenario("missing-usage", (_options, result) => {
    assert.equal(result.outcome, "response-only", JSON.stringify(result));
    assert.equal(result.cost.usd, null);
    assert.equal(result.cost.complete, false);
    assert.equal(result.usage[0]?.input, null);
  });
});

test("provider errors retain infrastructure failure rather than an ambiguity candidate", async () => {
  await scenario("provider-error", (_options, result) => {
    assert.equal(
      result.outcome,
      "infrastructure-failed",
      JSON.stringify(result),
    );
    assert.ok(result.reason?.includes("failed"));
    assert.equal(result.cost.usd, null);
  });
});

test("case deadline cancels a hung model call and saves the partial request", async () => {
  await scenario("hang", (options, result) => {
    assert.equal(result.outcome, "timed-out", JSON.stringify(result));
    assert.equal(result.evidence.requestCount, 1);
    assert.ok(fs.existsSync(path.join(options.outputDir, "chat.json")));
    assert.equal(result.cost.usd, null);
  });
});

test("idle completion wakes the same real teacher and persists its delivered marker", async () => {
  await scenario("text", async (options) => {
    const saved = readJson(
      path.join(options.outputDir, "chat.json"),
    ) as ChatRecord;
    const { chatStore } = await import("../../src/store/chats.ts");
    const { jobStore } = await import("../../src/store/jobs.ts");
    const { createJobRunner } =
      await import("../../src/agent/subagents/runner.ts");
    const { deliverJobResult, discardChatDeliveries } =
      await import("../../src/server/jobs.ts");
    const { runningTurn } = await import("../../src/server/turn-runs.ts");
    const job = await jobStore.createJob({
      kind: "plot",
      chatId: saved.id,
      toolCallId: "idle_plot",
      input,
    });
    const runner = createJobRunner({
      chatStore,
      jobStore,
      deliver: deliverJobResult,
    });
    await runner.runJob(job.id, input);
    const deadline = Date.now() + 5_000;
    let delivered = false;
    while (Date.now() < deadline) {
      const record = (await chatStore.getChat(saved.id))!;
      const observation = observeDelivery(
        record,
        await jobStore.listJobs(saved.id),
        projectView(record.messages),
      );
      delivered =
        observation.allDelivered &&
        observation.deliveries[0]!.postDeliveryTeacherText;
      if (delivered && !runningTurn(saved.id)) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    discardChatDeliveries(saved.id);
    assert.equal(delivered, true);
  });
});
