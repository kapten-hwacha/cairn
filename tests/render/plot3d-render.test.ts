import assert from "node:assert/strict";
import { test } from "node:test";
import {
  headlessOverride,
  realHeadless,
} from "../../src/agent/subagents/headless.ts";
import { renderPlot3D } from "../../src/agent/plot3d.ts";
import type { Plot3DInput } from "../../src/core/contracts/plot3d.ts";
const base: Plot3DInput = {
  kind: "3d",
  title: "Test $z$",
  xLabel: "$x$",
  yLabel: "$y$",
  zLabel: "$z$",
  xDomain: [-2, 2],
  yDomain: [-2, 2],
  zDomain: [-2, 4],
  series: [
    {
      kind: "surface",
      label: "$x^2+y^2$",
      expression: "x^2+y^2",
      xDomain: [-1, 1],
      yDomain: [-1, 1],
    },
  ],
};
test("3D renderer requires matching runtime proof and preserves supplied data as data", async () => {
  const png = (
    await realHeadless.renderSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"><rect width="900" height="650" fill="white"/></svg>',
    )
  ).toString("base64");
  try {
    let seen = "";
    headlessOverride.current = {
      ...realHeadless,
      verifyPlot3D: async (request) => {
        seen = request.html;
        return {
          ...request.expected,
          ready: true,
          errors: [],
          preview: `data:image/png;base64,${png}`,
        };
      },
    };
    const result = await renderPlot3D(base);
    assert.equal(result.format, "interactive");
    assert.equal(result.runtime.checked, true);
    assert.ok(result.html.length < 8 * 1024 * 1024);
    assert.equal(result.runtime.titleHashes.length, 3);
    assert.match(seen, /preparedAxisText/);
    assert.doesNotMatch(seen, /<script[^>]+src=/);
    assert.match(seen, /connectgaps/);
    const scatter = await renderPlot3D({
      ...base,
      series: [
        { kind: "scatter", label: "Given", points: [{ x: 1, y: 2, z: 3 }] },
      ],
    });
    const payload = JSON.parse(
      scatter.html.match(
        /id="plot-data" type="application\/json">(.*?)<\/script>/s,
      )![1]!,
    );
    assert.equal(payload.traces[0].mode, "markers");
    assert.deepEqual(payload.traces[0].z, [3]);
    headlessOverride.current = {
      ...realHeadless,
      verifyPlot3D: async (request) => ({
        ...request.expected,
        sceneHash: "wrong",
        ready: true,
        errors: [],
        preview: `data:image/png;base64,${png}`,
      }),
    };
    await assert.rejects(() => renderPlot3D(base), /verification/);
  } finally {
    delete headlessOverride.current;
  }
});
test("3D renderer fails missing runtime capability and honors abort", async () => {
  try {
    headlessOverride.current = { ...realHeadless, verifyPlot3D: undefined };
    await assert.rejects(() => renderPlot3D(base), /verification unavailable/);
    await assert.rejects(
      () => renderPlot3D(base, { signal: AbortSignal.abort() }),
      /abort/i,
    );
  } finally {
    delete headlessOverride.current;
  }
});

test("persisted 3D plot jobs bypass model selection and deliver an interactive artifact", async () => {
  const { createJobRunner } = await import("../../src/agent/subagents/runner.ts");
  const { chatStore } = await import("../../src/store/chats.ts");
  const { jobStore } = await import("../../src/store/jobs.ts");
  const { isSubagentFailure } = await import("../../src/core/contracts/jobs.ts");
  const chat = await chatStore.createChat("3D runner test");
  const png = (
    await realHeadless.renderSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"/>',
    )
  ).toString("base64");
  try {
    headlessOverride.current = {
      ...realHeadless,
      verifyPlot3D: async (request) => ({
        ...request.expected,
        ready: true,
        errors: [],
        preview: `data:image/png;base64,${png}`,
      }),
    };
    const job = await jobStore.createJob({
      kind: "plot",
      chatId: chat.id,
      toolCallId: "three-d-direct",
      input: base,
    });
    const steers: unknown[] = [];
    const runner = createJobRunner({
      chatStore,
      jobStore,
      engineFor: () => assert.fail("Direct 3D plot must not select a model"),
      deliver: async (steer) => {
        steers.push(steer);
      },
    });
    await runner.runJob(job.id);
    const saved = await jobStore.getJob(job.id);
    assert.equal(saved?.status, "done");
    assert.equal((saved?.result as any).format, "interactive");
    assert.equal(isSubagentFailure("plot", saved!.result as any), false);
    assert.equal(saved?.delivery?.status, "pending");
    assert.equal(steers.length, 1);
  } finally {
    delete headlessOverride.current;
    await jobStore.deleteJobsForChat(chat.id);
    await chatStore.deleteChat(chat.id);
  }
});
