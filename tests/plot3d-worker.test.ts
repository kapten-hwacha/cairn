import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPlot3DViaHost } from "../src/worker/plot3d-verify.ts";
import { realHeadless } from "../src/agent/subagents/headless.ts";
const expected = {
  rendererVersion: "4.3.0",
  sceneHash: "scene",
  titleHashes: ["x", "y", "z"],
  width: 900 as const,
  height: 650 as const,
};
const request = { html: "<html></html>", expected };
function endpoint() {
  const handlers = new Set<(e: MessageEvent) => void>(),
    sent: any[] = [];
  return {
    sent,
    handlers,
    postMessage: (m: unknown) => {
      sent.push(m);
    },
    addEventListener: (_t: "message", f: (e: MessageEvent) => void) => {
      handlers.add(f);
    },
    removeEventListener: (_t: "message", f: (e: MessageEvent) => void) => {
      handlers.delete(f);
    },
    emit: (data: unknown) => {
      for (const f of handlers) f({ data } as MessageEvent);
    },
  };
}
test("worker verification rejects stale IDs, validates proof and cleans pending listeners", async () => {
  const png = (
    await realHeadless.renderSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"/>',
    )
  ).toString("base64");
  const host = endpoint();
  const promise = verifyPlot3DViaHost(request, {}, host);
  const id = host.sent[0].requestId;
  host.emit({ type: "lh:plot3d-result", requestId: "stale", error: "no" });
  assert.equal(host.handlers.size, 1);
  host.emit({
    type: "lh:plot3d-result",
    requestId: id,
    result: {
      ...expected,
      ready: true,
      errors: [],
      preview: `data:image/png;base64,${png}`,
    },
  });
  assert.equal((await promise).ready, true);
  assert.equal(host.handlers.size, 0);
  const bad = verifyPlot3DViaHost(request, {}, host);
  host.emit({
    type: "lh:plot3d-result",
    requestId: host.sent.at(-1).requestId,
    result: { ready: true },
  });
  await assert.rejects(() => bad, /verification/);
  assert.equal(host.handlers.size, 0);
});
test("worker abort cancels the host and removes listeners", async () => {
  const host = endpoint(),
    controller = new AbortController();
  const promise = verifyPlot3DViaHost(
    request,
    { signal: controller.signal },
    host,
  );
  controller.abort();
  await assert.rejects(() => promise, /abort/i);
  assert.equal(host.handlers.size, 0);
  assert.equal(host.sent.at(-1).type, "lh:cancel-plot3d");
  assert.throws(
    () => verifyPlot3DViaHost(request, { signal: AbortSignal.abort() }, host),
    /abort/i,
  );
});

test("host accepts only its iframe and request ID, then cleans success, failure, cancel and timeout", async (t) => {
  const { installPlot3DHost } = await import("../src/client/plot3d-host.ts");
  const png = (
    await realHeadless.renderSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"/>',
    )
  ).toString("base64");
  const listeners = new Set<(e: MessageEvent) => void>();
  const frames: any[] = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"),
    oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (_t: string, f: (e: MessageEvent) => void) =>
        listeners.add(f),
      removeEventListener: (_t: string, f: (e: MessageEvent) => void) =>
        listeners.delete(f),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const frame = {
          sandbox: { add: () => {} },
          style: {},
          setAttribute: () => {},
          contentWindow: { postMessage: () => {} },
          remove: () => {
            frame.removed = true;
          },
          removed: false,
          onload: null,
        };
        return frame;
      },
      body: { appendChild: (f: unknown) => frames.push(f) },
    },
  });
  const host = endpoint();
  const dispose = installPlot3DHost(host);
  const emit = (source: unknown, data: unknown) => {
    for (const handler of listeners) handler({ source, data } as MessageEvent);
  };
  const valid = {
    ...expected,
    ready: true,
    errors: [],
    preview: `data:image/png;base64,${png}`,
  };
  try {
    host.emit({ type: "lh:render-plot3d", requestId: "one", request });
    emit({}, { type: "lh:plot3d-verified", requestId: "one", result: valid });
    emit(frames[0].contentWindow, {
      type: "lh:plot3d-verified",
      requestId: "wrong",
      result: valid,
    });
    assert.equal(host.sent.length, 0);
    emit(frames[0].contentWindow, {
      type: "lh:plot3d-verified",
      requestId: "one",
      result: valid,
    });
    assert.equal(host.sent[0].result.ready, true);
    assert.equal(frames[0].removed, true);
    assert.equal(listeners.size, 0);
    host.emit({ type: "lh:render-plot3d", requestId: "two", request });
    emit(frames[1].contentWindow, {
      type: "lh:plot3d-verified",
      requestId: "two",
      result: { ready: true },
    });
    assert.match(host.sent[1].error, /verification/);
    assert.equal(frames[1].removed, true);
    host.emit({ type: "lh:render-plot3d", requestId: "three", request });
    host.emit({ type: "lh:cancel-plot3d", requestId: "three" });
    assert.equal(frames[2].removed, true);
    assert.equal(listeners.size, 0);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    host.emit({ type: "lh:render-plot3d", requestId: "four", request });
    t.mock.timers.tick(30000);
    assert.match(host.sent.at(-1).error, /timed out/);
    assert.equal(frames[3].removed, true);
  } finally {
    dispose();
    t.mock.timers.reset();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
