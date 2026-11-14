import {
  PLOT3D_DEADLINE_MS,
  validatePlot3DVerification,
  type Plot3DVerification,
  type Plot3DVerificationRequest,
} from "../core/contracts/plot3d.ts";
interface WorkerEndpoint {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    handler: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    handler: (event: MessageEvent) => void,
  ): void;
}
export function verifyPlot3DViaHost(
  request: Plot3DVerificationRequest,
  options: { signal?: AbortSignal } = {},
  endpoint: WorkerEndpoint = self,
): Promise<Plot3DVerification> {
  const requestId = crypto.randomUUID();
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let finished = false;
    const stages = ["request-sent"];
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            `3D runtime verification timed out after 30s (${stages.join(" → ")})`,
          ),
        ),
      PLOT3D_DEADLINE_MS,
    );
    function cleanup() {
      clearTimeout(timer);
      endpoint.removeEventListener("message", onMessage);
      options.signal?.removeEventListener("abort", onAbort);
    }
    function fail(error: unknown) {
      if (finished) return;
      finished = true;
      cleanup();
      endpoint.postMessage({ type: "lh:cancel-plot3d", requestId });
      reject(error);
    }
    function onAbort() {
      fail(options.signal?.reason ?? new Error("3D verification aborted"));
    }
    function onMessage(event: MessageEvent) {
      const message = event.data;
      if (
        message?.type === "lh:plot3d-progress" &&
        message?.requestId === requestId
      ) {
        if (stages.length < 20) stages.push(String(message.stage));
        return;
      }
      if (
        message?.type !== "lh:plot3d-result" ||
        message?.requestId !== requestId
      )
        return;
      if (message.error) {
        fail(new Error(String(message.error)));
        return;
      }
      try {
        validatePlot3DVerification(message.result, request.expected);
        finished = true;
        cleanup();
        resolve(message.result);
      } catch (error) {
        fail(error);
      }
    }
    endpoint.addEventListener("message", onMessage);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    endpoint.postMessage({ type: "lh:render-plot3d", requestId, request });
  });
}
