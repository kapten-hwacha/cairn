/** Trusted document runtime; it consumes data, never teacher-authored code. */
export const PLOT3D_RUNTIME = String.raw`
(function () {
  "use strict";
  const payload = JSON.parse(document.getElementById("plot-data").textContent);
  const gd = document.getElementById("plot");
  const initialCamera = JSON.parse(JSON.stringify(payload.layout.scene.camera));
  const stage = (value) =>
    parent.postMessage({ type: "lh:plot3d-stage", stage: value }, "*");
  stage("runtime-started");
  const errors = [];
  let disposed = false,
    ready = false,
    initCount = 0,
    requestId = null;
  const frame = () => new Promise(requestAnimationFrame);
  function fail(error) {
    const message = String((error && error.message) || error);
    errors.push(message);
    parent.postMessage(
      { type: "lh:plot3d-view", event: "error", error: message },
      "*",
    );
  }
  addEventListener("error", (e) => fail(e.message));
  addEventListener("unhandledrejection", (e) => fail(e.reason));
  const originalError = console.error;
  console.error = function () {
    fail(Array.from(arguments).join(" "));
    originalError.apply(console, arguments);
  };
  function inspect() {
    if (!ready || disposed) throw new Error("3D plot is not ready");
    const scene = gd._fullLayout.scene._scene;
    const axes = scene.glplot.axes;
    const hashes = (axes.preparedLabels || []).map((m) => m && m.meshHash);
    if (JSON.stringify(hashes) !== JSON.stringify(payload.proof.titleHashes))
      throw new Error("Native title hash mismatch");
    const resolution = [
      axes.gl.drawingBufferWidth,
      axes.gl.drawingBufferHeight,
    ];
    if (!resolution.every((n) => Number.isFinite(n) && n > 0))
      throw new Error("Invalid WebGL drawing buffer");
    const scale = axes._text.titleTransforms.pixelScale;
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error("Invalid native title scale");
    const adjustments = axes._text.titleAdjustments;
    payload.proof.titleHashes.forEach((hash, i) => {
      const a = adjustments && adjustments[i];
      if (
        !a ||
        !a.fits ||
        !a.inkBoundsClip ||
        !a.inkBoundsClip.every(Number.isFinite) ||
        !Number.isFinite(a.angleRadians) ||
        !a.shiftClip.every(Number.isFinite)
      )
        throw new Error(
          "scene." +
            ["xaxis", "yaxis", "zaxis"][i] +
            ".title: title cannot fit the viewport",
        );
      const b = a.inkBoundsClip,
        ix = (4 * scale) / resolution[0],
        iy = (4 * scale) / resolution[1];
      if (
        b[0] < -1 + ix - 1e-6 ||
        b[1] < -1 + iy - 1e-6 ||
        b[2] > 1 - ix + 1e-6 ||
        b[3] > 1 - iy + 1e-6
      )
        throw new Error("Native title escaped viewport");
      if (!axes.preparedLabels[i].cells.length)
        throw new Error("Empty native title");
    });
    if (Plotly.version !== payload.proof.rendererVersion)
      throw new Error("Renderer version mismatch");
    return {
      camera: scene.getCamera(),
      initCount,
      hashes,
      resolution,
      adjustments,
      scrollZoom: !!gd._context.scrollZoom,
      uploads: axes._text.preparedUploadCount,
    };
  }
  async function capture() {
    await boot;
    const state = inspect();
    await Plotly.relayout(gd, { "scene.camera": state.camera });
    await frame();
    await frame();
    inspect();
    const preview = await Plotly.toImage(gd, {
      format: "png",
      width: 900,
      height: 650,
    });
    const image = new Image();
    image.src = preview;
    await image.decode();
    if (image.naturalWidth !== 900 || image.naturalHeight !== 650)
      throw new Error("PNG dimensions mismatch");
    if (errors.length) throw new Error(errors.join("; "));
    return Object.assign(
      { ready: true, preview, errors: errors.slice() },
      payload.proof,
    );
  }
  async function configure(expanded) {
    await boot;
    gd._context.scrollZoom = !!expanded;
    await Plotly.Plots.resize(gd);
    await frame();
    await frame();
    inspect();
  }
  function dispose() {
    if (!disposed) {
      disposed = true;
      ready = false;
      Plotly.purge(gd);
    }
  }
  const boot = (async () => {
    if (!(
      document.createElement("canvas").getContext("webgl") ||
      document.createElement("canvas").getContext("webgl2")
    ))
      throw new Error("WebGL unavailable");
    stage("webgl-available");
    if (parent === window) payload.config.scrollZoom = true;
    await Plotly.newPlot(gd, payload.traces, payload.layout, payload.config);
    stage("plot-created");
    initCount++;
    gd.querySelectorAll("canvas").forEach((canvas) =>
      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        fail("WebGL context lost");
      }),
    );
    await frame();
    await frame();
    ready = true;
    inspect();
    parent.postMessage({ type: "lh:plot3d-view", event: "ready" }, "*");
  })();
  boot.catch(fail);
  if (parent === window) {
    const button = document.createElement("button");
    button.textContent = "Reset view";
    button.style.cssText =
      "position:fixed;right:12px;top:12px;z-index:10;padding:6px 10px";
    button.addEventListener("click", () =>
      window.__lhPlot3D.reset().catch(fail),
    );
    document.body.appendChild(button);
  }
  window.__lhPlot3D = {
    boot,
    capture,
    inspect,
    configure,
    dispose,
    async reset() {
      await boot;
      await Plotly.relayout(gd, { "scene.camera": initialCamera });
      await frame();
      await frame();
      return inspect();
    },
  };
  addEventListener("message", async (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || typeof m !== "object") return;
    try {
      if (
        m.type === "lh:plot3d-verify" &&
        typeof m.requestId === "string" &&
        requestId === null
      ) {
        requestId = m.requestId;
        const result = await capture();
        parent.postMessage(
          { type: "lh:plot3d-verified", requestId, result },
          "*",
        );
      } else if (m.type === "lh:plot3d-dispose") dispose();
      else if (m.type === "lh:plot3d-configure") await configure(m.expanded);
      else if (m.type === "lh:plot3d-reset") await window.__lhPlot3D.reset();
      else if (m.type === "lh:plot3d-state")
        parent.postMessage(
          { type: "lh:plot3d-state", requestId: m.requestId, state: inspect() },
          "*",
        );
      else if (m.type === "lh:plot3d-camera" && m.camera) {
        await boot;
        await Plotly.relayout(gd, { "scene.camera": m.camera });
        await frame();
        await frame();
        parent.postMessage(
          { type: "lh:plot3d-state", requestId: m.requestId, state: inspect() },
          "*",
        );
      }
    } catch (error) {
      if (m.type === "lh:plot3d-verify")
        parent.postMessage(
          {
            type: "lh:plot3d-verified",
            requestId: m.requestId,
            error: String(error.message || error),
          },
          "*",
        );
      else fail(error);
    }
  });
  addEventListener("resize", () => {
    if (ready && !disposed) configure(gd._context.scrollZoom).catch(fail);
  });
  addEventListener("keydown", (e) => {
    parent.postMessage(
      {
        type: "lh:plot3d-view",
        event: e.key === "Escape" ? "escape" : "input",
      },
      "*",
    );
  });
  addEventListener("pointerdown", () =>
    parent.postMessage({ type: "lh:plot3d-view", event: "input" }, "*"),
  );
  addEventListener(
    "wheel",
    () => parent.postMessage({ type: "lh:plot3d-view", event: "input" }, "*"),
    { passive: true },
  );
  addEventListener("blur", () =>
    parent.postMessage({ type: "lh:plot3d-view", event: "blur" }, "*"),
  );
  addEventListener("pagehide", dispose);
})();
`;
