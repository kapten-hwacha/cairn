import "./shims.ts";
import "../../app/globals.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { installTauriPreload } from "./tauri-preload.ts";
import { initWorkerClient } from "./worker-client.ts";
import { InteractivePlotCard } from "../../components/artifacts/interactive-plot-card.tsx";
import {
  validatePlot3DPng,
  type Plot3DInput,
  type Plot3DResult,
} from "../core/contracts/plot3d.ts";
installTauriPreload({ invoke, listen, platform: "darwin" });
const root = createRoot(document.getElementById("root")!);
const checks: string[] = [];
const previews: string[] = [];
const trace: unknown[] = [];
const csp = document.querySelector<HTMLMetaElement>(
  'meta[http-equiv="Content-Security-Policy"]',
)?.content;
const base = {
  kind: "3d" as const,
  title: "Native 3D verification",
  xLabel: "$x^2$",
  yLabel: "$\\frac{y}{8}$",
  zLabel: "$\\sqrt{z}$",
  xDomain: [-2, 2] as [number, number],
  yDomain: [-2, 2] as [number, number],
  zDomain: [-2, 4] as [number, number],
};
const fixtures: Record<string, Plot3DInput> = {
  surface: {
    ...base,
    series: [
      {
        kind: "surface",
        label: "$z=x^2+y^2$",
        expression: "x^2+y^2",
        xDomain: [-1, 1],
        yDomain: [-1, 1],
      },
    ],
  },
  helix: {
    ...base,
    series: [
      {
        kind: "parametric",
        label: "Helix",
        xExpression: "cos(u)",
        yExpression: "sin(u)",
        zExpression: "u/2",
        uDomain: [0, 2 * Math.PI],
      },
    ],
  },
  scatter: {
    ...base,
    series: [
      {
        kind: "scatter",
        label: "Supplied data",
        points: [
          { x: -1, y: 0, z: 1 },
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 0, z: 2 },
        ],
      },
    ],
  },
};
fixtures.mixed = {
  ...base,
  title: "Four series and mathematical legends",
  series: [
    ...fixtures.surface!.series,
    ...fixtures.helix!.series,
    ...fixtures.scatter!.series,
    {
      kind: "surface",
      label: "A second continuous branch with $z=x-y$",
      expression: "x-y",
      xDomain: [-1, 1],
      yDomain: [-1, 1],
    },
  ],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks.push(message);
}
async function until<T>(
  read: () => T | undefined | false | null,
  timeout = 30000,
): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Smoke wait timed out");
}
function button(text: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;
}
function frame(): HTMLIFrameElement {
  return document.querySelector('[data-testid="plot3d-iframe"]')!;
}
async function state(camera?: object): Promise<any> {
  const target = frame().contentWindow!;
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Viewer state timed out"));
    }, 10000);
    function handler(e: MessageEvent) {
      if (
        e.source === target &&
        e.data?.type === "lh:plot3d-state" &&
        e.data.requestId === requestId
      ) {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve(e.data.state);
      }
    }
    window.addEventListener("message", handler);
    target.postMessage(
      {
        type: camera ? "lh:plot3d-camera" : "lh:plot3d-state",
        requestId,
        camera,
      },
      "*",
    );
  });
}
async function run() {
  const { worker } = initWorkerClient();
  worker.addEventListener("message", (e) => {
    if (e.data?.type === "lh:plot3d-progress") trace.push(e.data);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Worker boot timeout")),
      30000,
    );
    worker.addEventListener("message", function handler(e) {
      if (e.data?.type === "lh:worker-ready") {
        clearTimeout(timer);
        worker.removeEventListener("message", handler);
        resolve();
      }
      if (e.data?.type === "lh:worker-boot-error") {
        clearTimeout(timer);
        reject(new Error(JSON.stringify(e.data)));
      }
    });
  });
  async function render(
    input: Plot3DInput,
    disableWebGL = false,
  ): Promise<Plot3DResult> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener("message", handler);
        reject(new Error("Worker render timeout"));
      }, 40000);
      function handler(e: MessageEvent) {
        if (
          e.data?.type !== "lh:plot3d-smoke-result" ||
          e.data.requestId !== requestId
        )
          return;
        clearTimeout(timer);
        worker.removeEventListener("message", handler);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.result);
      }
      worker.addEventListener("message", handler);
      worker.postMessage({
        type: "lh:plot3d-smoke",
        requestId,
        input,
        disableWebGL,
      });
    });
  }
  let saved: Plot3DResult | undefined;
  for (const [name, input] of Object.entries(fixtures)) {
    const result = await render(input);
    validatePlot3DPng(result.preview.dataUrl);
    assert(
      result.runtime.checked,
      `${name}: actual worker/WebView runtime checked`,
    );
    assert(
      result.runtime.titleHashes.length === 3,
      `${name}: three native math titles verified`,
    );
    await invoke("lh_debug_write", {
      relPath: `plot3d-smoke/${name}.png.base64`,
      line: result.preview.dataUrl.slice(22),
      append: false,
    });
    previews.push(`${name}.png`);
    if (name === "surface") saved = result;
  }
  assert(saved, "Surface artifact saved");
  function mount(result: Plot3DResult, key: string) {
    flushSync(() =>
      root.render(
        <div
          data-session-artifact-scope
          style={{ height: "95vh", width: "min(900px,100vw)", paddingTop: 40 }}
        >
          <InteractivePlotCard key={key} result={result} />
        </div>,
      ),
    );
  }
  mount(saved, "initial");
  assert(!frame(), "Preview allocates no WebGL iframe");
  button("Interact").click();
  await until(() => document.querySelector('[data-phase="ready"]'));
  const win = frame().contentWindow;
  const camera = {
    eye: { x: 2, y: -1, z: 0.9 },
    center: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  };
  const before = await state(camera);
  assert(before.initCount === 1, "Viewer initialized once");
  assert(before.scrollZoom === false, "Inline wheel zoom disabled");
  button("Expand").focus();
  button("Expand").click();
  await until(() => document.querySelector('[data-plot3d-expanded="true"]'));
  await new Promise((r) => setTimeout(r, 300));
  const expanded = await state();
  assert(frame().contentWindow === win, "Expand preserves iframe window");
  assert(
    JSON.stringify(expanded.camera) === JSON.stringify(before.camera),
    "Expand preserves camera",
  );
  assert(expanded.initCount === 1, "Expand does not initialize again");
  assert(expanded.scrollZoom === true, "Expanded wheel zoom enabled");
  button("Close").click();
  await until(() => document.querySelector('[data-plot3d-expanded="false"]'));
  const closed = await state();
  assert(
    JSON.stringify(closed.camera) === JSON.stringify(before.camera),
    "Close preserves camera",
  );
  await until(() => document.activeElement === button("Expand"));
  assert(
    frame().contentWindow === win,
    "Closing restores focus without remounting",
  );
  button("Expand").click();
  await until(() => document.querySelector('[data-plot3d-expanded="true"]'));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await until(() => document.querySelector('[data-plot3d-expanded="false"]'));
  assert(
    frame().contentWindow === win,
    "Escape closes expanded viewer without remounting",
  );
  document.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
  const inverted = await state();
  assert(
    frame().contentWindow === win && inverted.initCount === 1,
    "Inversion preserves live figure",
  );
  assert(
    JSON.stringify(inverted.camera) === JSON.stringify(before.camera),
    "Inversion preserves camera",
  );
  button("Reset view").click();
  await new Promise((r) => setTimeout(r, 250));
  const reset = await state();
  assert(
    Math.abs(reset.camera.eye.x - 1.5) < 1e-8,
    "Reset view restores initial camera",
  );
  mount(JSON.parse(JSON.stringify(saved)), "restored");
  assert(!frame(), "Saved result restores verified preview");
  button("Interact").click();
  await until(() => document.querySelector('[data-phase="ready"]'));
  assert(
    (await state()).hashes.length === 3,
    "Saved result renders without preparation or model call",
  );
  let rejected = false;
  try {
    await render(fixtures.scatter!, true);
  } catch (e) {
    rejected = /WebGL unavailable/.test(String(e));
  }
  assert(rejected, "Unavailable WebGL fails actual runtime verification");
  const bad = {
    ...saved,
    html: saved.html.replace(
      "<head>",
      "<head><script>HTMLCanvasElement.prototype.getContext=function(){return null;}</script>",
    ),
  };
  mount(bad, "failed");
  button("Interact").click();
  await until(() => document.querySelector('[data-phase="error"]'));
  assert(
    !!document.querySelector('[data-testid="plot3d-preview"]') &&
      !!button("Retry"),
    "Viewer failure retains preview and Retry",
  );
  flushSync(() => root.render(<div>3D native checks passed.</div>));
  return {
    passed: true,
    checks,
    previews,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    trace,
  };
}
run()
  .then((report) =>
    invoke("lh_debug_write", {
      relPath: "plot3d-smoke/report.json",
      line: JSON.stringify(report),
      append: false,
    }),
  )
  .catch((error) =>
    invoke("lh_debug_write", {
      relPath: "plot3d-smoke/report.json",
      line: JSON.stringify({
        passed: false,
        error: String(error),
        stack: error?.stack,
        checks,
        previews,
        trace,
        csp,
      }),
      append: false,
    }),
  );
