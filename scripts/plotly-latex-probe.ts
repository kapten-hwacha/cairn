import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import puppeteer from "puppeteer-core";

export interface ProbeFixture {
  schemaVersion: 1;
  labels: string[];
  initialCamera: { x: number; y: number; z: number };
  actions: Array<"initial" | "rotate" | "zoom">;
}

const fixturePath = fileURLToPath(
  new URL("../tests/fixtures/visualization/plotly-latex.json", import.meta.url),
);
const scriptData = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");
const inlineScript = (source: string) =>
  source.replace(/<\/script/gi, "<\\/script");

/** Standalone experiment only: no production renderer or dependency changes. */
export function buildProbeHtml(
  plotly: string,
  mathjax: string,
  fixture: ProbeFixture,
  mode: "native" | "annotations",
  csp?: string,
): string {
  if (
    fixture.schemaVersion !== 1 ||
    fixture.labels.length !== 3 ||
    !fixture.labels.every((label) => typeof label === "string") ||
    ![
      fixture.initialCamera.x,
      fixture.initialCamera.y,
      fixture.initialCamera.z,
    ].every(Number.isFinite) ||
    fixture.actions.join(",") !== "initial,rotate,zoom"
  )
    throw new Error("Invalid probe fixture");
  const policy = csp
    ? `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('"', "&quot;")}">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${policy}
<title>Plotly LaTeX probe: ${mode}</title><link rel="icon" href="data:,">
<style>body{margin:0;background:white;color:#111;font:16px sans-serif}#plot{width:900px;height:650px}#status{padding:12px;white-space:pre-wrap}</style>
<script>window.__probe={ready:false,error:null,conversions:0,renderRevision:0};
window.MathJax={loader:{paths:{mathjax:'https://mathjax.invalid/',sre:'https://mathjax.invalid/sre',mathmaps:'https://mathjax.invalid/mathmaps'}},startup:{typeset:false},options:{enableMenu:false,enableExplorer:false,enableEnrichment:false,enableSpeech:false,enableBraille:false,menuOptions:{settings:{enrich:false,speech:false,braille:false}}},svg:{fontCache:'none'}};
window.addEventListener('error',e=>{window.__probe.error=e.message});
window.addEventListener('unhandledrejection',e=>{window.__probe.error=String(e.reason)});</script>
<script>${inlineScript(mathjax)}</script><script>${inlineScript(plotly)}</script>
</head><body><div id="plot"></div><pre id="status">Loading…</pre><script>
(async()=>{
try{
const fixture=${scriptData(fixture)}, mode=${scriptData(mode)};
await MathJax.startup.promise;
const mj=MathJax._.mathjax.mathjax, originalDocument=mj.document;
mj.document=function(...args){const doc=originalDocument.apply(this,args),convert=doc.convert;doc.convert=function(...values){window.__probe.conversions++;return convert.apply(this,values)};return doc};
const grid=Array.from({length:33},(_,i)=>-2+i/8);
const z=grid.map(y=>grid.map(x=>x*x-y*y));
const axis=(index)=>({range:index===2?[-4,4]:[-2,2],title:{text:mode==='native'?fixture.labels[index]:''},autorange:false});
const anchors=[[2,-2,-4],[-2,2,-4],[-2,-2,4]];
const annotations=mode==='annotations'?fixture.labels.map((text,i)=>({x:anchors[i][0],y:anchors[i][1],z:anchors[i][2],text,showarrow:false,font:{size:18,color:'#9c1458'},xshift:i===0?15:-15,yshift:i===2?12:-16})):[];
const layout={width:900,height:650,margin:{l:65,r:65,t:55,b:65},title:{text:'Saddle surface: '+mode},scene:{xaxis:axis(0),yaxis:axis(1),zaxis:axis(2),annotations,aspectmode:'cube',camera:{eye:fixture.initialCamera}}};
const gd=document.getElementById('plot');
await Plotly.newPlot(gd,[{type:'surface',x:grid,y:grid,z,showscale:false,colorscale:'Viridis'}],layout,{displayModeBar:false,plotGlPixelRatio:1,scrollZoom:true});
const scene=gd._fullLayout.scene._scene,drawAnnotations=scene.drawAnnotations;
scene.drawAnnotations=function(...args){window.__probe.renderRevision++;return drawAnnotations.apply(this,args)};
window.__probe.plotlyVersion=Plotly.version;window.__probe.mathjaxVersion=MathJax.version;
window.__probe.ready=true;document.getElementById('status').textContent='Ready: '+mode;
}catch(error){window.__probe.error=String(error);document.getElementById('status').textContent=String(error)}
})();</script></body></html>`;
}

interface PageProbe {
  ready: boolean;
  error: string | null;
  conversions: number;
  renderRevision: number;
  plotlyVersion: string;
  mathjaxVersion: string;
}
interface ProbeBrowserWindow extends Window {
  __probe: PageProbe;
  Plotly: {
    relayout: (plot: Element, layout: Record<string, unknown>) => Promise<void>;
    toImage: (
      plot: Element,
      options: Record<string, unknown>,
    ) => Promise<string>;
    purge: (plot: Element) => void;
  };
}
interface ProbePlot extends HTMLElement {
  _fullLayout: {
    scene: {
      _scene: {
        getCamera: () => { eye: { x: number; y: number; z: number } };
        glplot: { cameraParams: { view: number[] } };
      };
    };
  };
}

export async function runProbe(
  plotlyDir: string,
  out: string,
): Promise<boolean> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out, { recursive: false });
  const report: {
    schemaVersion: number;
    assets?: unknown;
    browser?: string;
    cases: unknown[];
    error?: string;
  } = { schemaVersion: 1, cases: [] };
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plotly-probe-"));
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(plotlyDir, "package.json"), "utf8"),
    ) as { name: string; version: string; main: string };
    if (
      manifest.name !== "plotly.js-gl3d-dist-min" ||
      manifest.version !== "4.3.0" ||
      manifest.main !== "plotly-gl3d.min.js"
    )
      throw new Error("Probe requires plotly.js-gl3d-dist-min@4.3.0");
    const plotly = fs.readFileSync(path.join(plotlyDir, manifest.main), "utf8");
    const mathjax = fs.readFileSync(
      new URL(
        "../node_modules/@mathjax/mathjax-tex-font/tex-mml-svg-mathjax-tex.js",
        import.meta.url,
      ),
      "utf8",
    );
    const describe = (source: string) => ({
      bytes: Buffer.byteLength(source),
      gzipBytes: gzipSync(source).length,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
    report.assets = {
      plotly: { ...manifest, ...describe(plotly) },
      mathjax: { version: "4.1.3", ...describe(mathjax) },
    };
    const fixture = JSON.parse(
      fs.readFileSync(fixturePath, "utf8"),
    ) as ProbeFixture;
    const config = JSON.parse(
      fs.readFileSync(
        new URL("../src-tauri/tauri.conf.json", import.meta.url),
        "utf8",
      ),
    ) as { app: { security: { csp: string } } };
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH ??
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      pipe: true,
      userDataDir: profile,
    });
    report.browser = await browser.version();
    for (const policy of ["plain", "app-csp", "app-csp-sandbox"] as const) {
      for (const mode of ["native", "annotations"] as const) {
        const id = `${policy}-${mode}`;
        const html = buildProbeHtml(
          plotly,
          mathjax,
          fixture,
          mode,
          policy !== "plain" ? config.app.security.csp : undefined,
        );
        const htmlPath = path.join(out, `${id}.html`);
        fs.writeFileSync(
          htmlPath,
          policy === "app-csp-sandbox"
            ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="${config.app.security.csp}"><title>Opaque sandbox probe</title><iframe id="probe-frame" sandbox="allow-scripts" style="width:920px;height:730px;border:0"></iframe><script>document.getElementById('probe-frame').srcdoc=${scriptData(html)}</script>`
            : html,
        );
        const page = await browser.newPage();
        await page.setViewport({
          width: 940,
          height: 760,
          deviceScaleFactor: 1,
        });
        const network: string[] = [],
          errors: string[] = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.setRequestInterception(true);
        await page.setOfflineMode(true);
        page.on("request", (request) => {
          if (
            request.url() === pathToFileURL(htmlPath).href ||
            /^(data:|blob:|about:)/.test(request.url())
          )
            void request.continue();
          else {
            network.push(request.url());
            void request.abort();
          }
        });
        const snapshots: unknown[] = [];
        try {
          await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
          const target =
            policy === "app-csp-sandbox"
              ? await (await page.waitForSelector(
                  "#probe-frame",
                ))!.contentFrame()
              : page.mainFrame();
          if (!target) throw new Error("Sandbox frame unavailable");
          await target.waitForFunction(
            () => {
              const state = (window as unknown as ProbeBrowserWindow).__probe;
              return state?.ready || state?.error;
            },
            { timeout: 15_000 },
          );
          for (const [index, action] of fixture.actions.entries()) {
            const started = performance.now();
            const previousRevision = await target.evaluate(
              () =>
                (window as unknown as ProbeBrowserWindow).__probe
                  .renderRevision,
            );
            const previousView = await target.evaluate(() =>
              JSON.stringify(
                (document.getElementById("plot") as ProbePlot)._fullLayout.scene
                  ._scene.glplot.cameraParams.view,
              ),
            );
            if (action === "rotate") {
              await page.mouse.move(430, 290);
              await page.mouse.down();
              await page.mouse.move(570, 350, { steps: 20 });
              await page.mouse.up();
            } else if (action === "zoom") {
              await page.mouse.move(430, 290);
              await page.mouse.wheel({ deltaY: 180 });
            }
            if (index > 0)
              await target.waitForFunction(
                (previous, revision) => {
                  const state = (window as unknown as ProbeBrowserWindow)
                    .__probe;
                  if (state.error) return true;
                  return (
                    state.renderRevision > revision &&
                    JSON.stringify(
                      (document.getElementById("plot") as ProbePlot)._fullLayout
                        .scene._scene.glplot.cameraParams.view,
                    ) !== previous
                  );
                },
                { timeout: 10_000 },
                previousView,
                previousRevision,
              );
            if (mode === "annotations")
              await target.waitForFunction(
                () => {
                  const w = window as unknown as ProbeBrowserWindow;
                  return (
                    w.__probe.error ||
                    (document.querySelectorAll(
                      ".annotation-scene .annotation-text-math-group",
                    ).length === 3 &&
                      Array.from(
                        document.querySelectorAll(
                          ".annotation-scene .annotation-text-math-group",
                        ),
                      ).every((el) => el.querySelector("svg path")))
                  );
                },
                { timeout: 10_000 },
              );
            const snapshot = await target.evaluate(() => {
              const w = window as unknown as ProbeBrowserWindow;
              const boxes = Array.from(
                document.querySelectorAll(".annotation-text-math-group"),
                (element) => {
                  const r = element.getBoundingClientRect();
                  return { x: r.x, y: r.y, width: r.width, height: r.height };
                },
              );
              return {
                ...w.__probe,
                boxes,
                canvases: document.querySelectorAll("canvas").length,
                opaqueOrigin: location.origin,
                actualCamera: (
                  document.getElementById("plot") as ProbePlot
                )._fullLayout.scene._scene.getCamera().eye,
                parentAccessBlocked:
                  window.parent !== window &&
                  (() => {
                    try {
                      void window.parent.document;
                      return false;
                    } catch {
                      return true;
                    }
                  })(),
              };
            });
            snapshots.push({
              ...snapshot,
              action,
              cameraUpdateMs: performance.now() - started,
            });
            await page.screenshot({
              path: path.join(out, `${id}-${index}.png`),
            });
            if (snapshot.error) break;
          }
          const beforeDrag = await target.evaluate(
            () => (window as unknown as ProbeBrowserWindow).__probe.conversions,
          );
          const dragStarted = performance.now();
          await page.mouse.move(430, 290);
          await page.mouse.down();
          await page.mouse.move(570, 350, { steps: 20 });
          await page.mouse.up();
          if (mode === "annotations")
            await target.waitForFunction(
              () =>
                document.querySelectorAll(
                  ".annotation-scene .annotation-text-math-group svg",
                ).length === 3,
              { timeout: 10_000 },
            );
          const drag = {
            elapsedMs: performance.now() - dragStarted,
            steps: 20,
            conversions:
              (await target.evaluate(
                () =>
                  (window as unknown as ProbeBrowserWindow).__probe.conversions,
              )) - beforeDrag,
          };
          const exported = await target.evaluate(async () => {
            const w = window as unknown as ProbeBrowserWindow;
            if (w.__probe.error) return null;
            const plot = document.getElementById("plot")!;
            // Preserve the ready live SVG labels before Plotly's export redraw
            // deletes them and starts asynchronous MathJax conversion again.
            const overlays = Array.from(
              plot.querySelectorAll(".infolayer > .annotation-scene"),
              (node) => node.cloneNode(true),
            );
            const svg = await w.Plotly.toImage(plot, {
              format: "svg",
              width: 900,
              height: 650,
            });
            const png = await w.Plotly.toImage(plot, {
              format: "png",
              width: 900,
              height: 650,
            });
            const svgText = svg.includes(";base64,")
              ? atob(svg.slice(svg.indexOf(",") + 1))
              : decodeURIComponent(svg.slice(svg.indexOf(",") + 1));
            const documentSvg = new DOMParser().parseFromString(
              svgText,
              "image/svg+xml",
            );
            const rawMathGroups = documentSvg.querySelectorAll(
              ".annotation-text-math-group",
            ).length;
            documentSvg
              .querySelectorAll(".annotation-scene")
              .forEach((node) => node.remove());
            const layer = documentSvg.querySelector(".infolayer");
            if (!layer) throw new Error("Export SVG has no label layer");
            for (const node of overlays)
              layer.appendChild(documentSvg.importNode(node, true));
            const composedSvg =
              "data:image/svg+xml;charset=utf-8," +
              encodeURIComponent(
                new XMLSerializer().serializeToString(documentSvg),
              );
            const composedImage = new Image();
            composedImage.src = composedSvg;
            await composedImage.decode();
            const composedCanvas = document.createElement("canvas");
            composedCanvas.width = 900;
            composedCanvas.height = 650;
            composedCanvas.getContext("2d")!.drawImage(composedImage, 0, 0);
            const composedPng = composedCanvas.toDataURL("image/png");
            const pixelChecks = [];
            for (const url of [png, composedPng]) {
              const image = new Image();
              image.src = url;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const ctx = canvas.getContext("2d")!;
              ctx.drawImage(image, 0, 0);
              const pixels = ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
              let labelPixels = 0;
              for (let i = 0; i < pixels.length; i += 4)
                if (
                  pixels[i]! > 100 &&
                  pixels[i]! > 2 * pixels[i + 1]! &&
                  pixels[i + 2]! > 2 * pixels[i + 1]!
                )
                  labelPixels++;
              pixelChecks.push({
                labelPixels,
                width: canvas.width,
                height: canvas.height,
              });
            }
            return {
              svg,
              png,
              checks: { mathGroups: rawMathGroups, ...pixelChecks[0]! },
              composedSvg,
              composedPng,
              composedChecks: {
                mathGroups: documentSvg.querySelectorAll(
                  ".annotation-text-math-group",
                ).length,
                ...pixelChecks[1]!,
              },
            };
          });
          if (exported) {
            for (const [suffix, url] of [
              ["export.svg", exported.svg],
              ["export.png", exported.png],
              ["composed-export.svg", exported.composedSvg],
              ["composed-export.png", exported.composedPng],
            ] as const) {
              const comma = url.indexOf(",");
              const bytes = /;base64,/.test(url)
                ? Buffer.from(url.slice(comma + 1), "base64")
                : Buffer.from(decodeURIComponent(url.slice(comma + 1)));
              fs.writeFileSync(path.join(out, `${id}-${suffix}`), bytes);
            }
          }
          report.cases.push({
            id,
            network,
            errors,
            snapshots,
            exported: !!exported,
            exportChecks: exported?.checks,
            composedExportChecks: exported?.composedChecks,
            drag,
            passed:
              errors.length === 0 &&
              network.length === 0 &&
              !!exported &&
              (mode === "native" ||
                (exported.composedChecks.mathGroups === 3 &&
                  exported.composedChecks.labelPixels > 50)),
          });
        } catch (error) {
          report.cases.push({
            id,
            network,
            errors,
            snapshots,
            error: String(error),
          });
          await page.screenshot({ path: path.join(out, `${id}-failure.png`) });
        } finally {
          await page.close();
        }
      }
    }
  } catch (error) {
    report.error = String(error);
  } finally {
    await browser?.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(report, null, 2),
    );
    const cards = report.cases.map((entry) => {
      const record = entry as { id: string; passed?: boolean };
      const svgPath = path.join(out, `${record.id}-composed-export.svg`);
      const preview = fs.existsSync(svgPath)
        ? `<img style="width:100%;max-width:900px" src="data:image/svg+xml;base64,${fs.readFileSync(svgPath).toString("base64")}">`
        : "<p>No exported frame.</p>";
      return `<section><h2>${record.id}: ${record.passed ? "checks passed" : "failed"}</h2><a href="${record.id}.html">Open isolated interactive probe</a>${preview}</section>`;
    });
    fs.writeFileSync(
      path.join(out, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Plotly LaTeX workaround evidence</title><style>body{max-width:1100px;margin:24px auto;font:16px sans-serif}section{border-bottom:1px solid #ccc;padding:20px 0}</style><h1>Plotly 4.3.0 / MathJax 4.1.3</h1><p>Native variants are controls showing the existing title limitation. Annotation variants test the workaround. Review placement separately from automated rendering/export checks.</p><a href="results.json">Machine-readable results</a>${cards.join("")}`,
    );
  }
  console.log(
    JSON.stringify({ out, error: report.error, cases: report.cases.length }),
  );
  return (
    !report.error &&
    report.cases.length === 6 &&
    report.cases.every(
      (entry) => (entry as { passed?: boolean }).passed === true,
    )
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const plotlyDir = args[args.indexOf("--plotly-dir") + 1];
  const out = args[args.indexOf("--out") + 1];
  if (
    !args.includes("--plotly-dir") ||
    !args.includes("--out") ||
    !plotlyDir ||
    !out
  )
    throw new Error(
      "Usage: --plotly-dir <package-directory> --out <new-directory>",
    );
  if (!(await runProbe(path.resolve(plotlyDir), path.resolve(out))))
    process.exitCode = 1;
}
