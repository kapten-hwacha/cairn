import {
  PLOT3D_DEADLINE_MS,
  PLOT3D_HTML_BYTES,
  validatePlot3DVerification,
  type Plot3DVerificationRequest,
} from "../core/contracts/plot3d.ts";
interface Plot3DHostWorker {
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
export function installPlot3DHost(worker: Plot3DHostWorker): () => void {
  const pending = new Map<string, () => void>();
  function onRequest(event: MessageEvent) {
    const message = event.data;
    if (message?.type === "lh:cancel-plot3d") {
      pending.get(message.requestId)?.();
      return;
    }
    if (message?.type !== "lh:render-plot3d") return;
    const { requestId } = message;
    if (
      typeof requestId !== "string" ||
      requestId.length > 128 ||
      pending.has(requestId)
    )
      return;
    const request = message.request as Plot3DVerificationRequest;
    if (
      !request ||
      typeof request.html !== "string" ||
      new TextEncoder().encode(request.html).length > PLOT3D_HTML_BYTES ||
      request.expected?.width !== 900 ||
      request.expected?.height !== 650
    ) {
      worker.postMessage({
        type: "lh:plot3d-result",
        requestId,
        error: "Invalid 3D verification request",
      });
      return;
    }
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.title = "Verifying 3D plot";
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "900px",
      height: "650px",
      opacity: "0.001",
      pointerEvents: "none",
      zIndex: "10000",
      border: "0",
    });
    let finished = false;
    const timer = setTimeout(
      () => finish(undefined, "3D runtime verification timed out after 30s"),
      PLOT3D_DEADLINE_MS,
    );
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", onReply);
      pending.delete(requestId);
      iframe.contentWindow?.postMessage({ type: "lh:plot3d-dispose" }, "*");
      iframe.remove();
    }
    function finish(result?: unknown, error?: string) {
      if (finished) return;
      finished = true;
      cleanup();
      worker.postMessage({
        type: "lh:plot3d-result",
        requestId,
        result,
        error,
      });
    }
    function onReply(event: MessageEvent) {
      if (
        event.source === iframe.contentWindow &&
        event.data?.type === "lh:plot3d-stage"
      ) {
        worker.postMessage({
          type: "lh:plot3d-progress",
          requestId,
          stage: String(event.data.stage),
        });
        if (event.data.error) finish(undefined, String(event.data.error));
        return;
      }
      if (
        event.source !== iframe.contentWindow ||
        event.data?.type !== "lh:plot3d-verified" ||
        event.data?.requestId !== requestId
      )
        return;
      if (event.data.error) {
        finish(undefined, String(event.data.error));
        return;
      }
      try {
        validatePlot3DVerification(event.data.result, request.expected);
        finish(event.data.result);
      } catch (error) {
        finish(undefined, String(error));
      }
    }
    pending.set(requestId, () => {
      if (!finished) {
        finished = true;
        cleanup();
      }
    });
    window.addEventListener("message", onReply);
    iframe.onload = () => {
      worker.postMessage({
        type: "lh:plot3d-progress",
        requestId,
        stage: "document-loaded",
      });
      iframe.contentWindow?.postMessage(
        { type: "lh:plot3d-verify", requestId },
        "*",
      );
    };
    iframe.srcdoc = request.html;
    document.body.appendChild(iframe);
  }
  worker.addEventListener("message", onRequest);
  return () => {
    worker.removeEventListener("message", onRequest);
    for (const cancel of pending.values()) cancel();
  };
}
