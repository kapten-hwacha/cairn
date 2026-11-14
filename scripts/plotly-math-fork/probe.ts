import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer, { type Frame, type Page } from "puppeteer-core";
import {
  prepareWithEvidence,
  prepareAxisText,
  saveMeshEvidence,
  preparationCounters,
} from "./prepare-mesh.ts";
import { validateMesh, sha256, type PreparedAxisText } from "./contracts.ts";
import { describeAsset, readSourceLock, verifyFile } from "./build.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
export interface Fixture {
  schemaVersion: 1;
  labels: string[];
  corpus: string[];
  initialCamera: { x: number; y: number; z: number };
  actions: string[];
  titleSizes: number[];
  viewports: number[][];
  devicePixelRatios: number[];
  repetitions: number;
  steps: number;
  titleBoundsSweep: {
    radius: number;
    azimuths: number[];
    elevations: number[];
    viewport: number[];
    size: number;
    devicePixelRatio: number;
    policy: string;
  };
}
export function titleSweepCameras(sweep: Fixture["titleBoundsSweep"]): Array<{
  azimuth: number;
  elevation: number;
  eye: { x: number; y: number; z: number };
}> {
  if (
    !sweep ||
    !Number.isFinite(sweep.radius) ||
    sweep.radius <= 0 ||
    !sweep.azimuths.length ||
    !sweep.elevations.length ||
    ![...sweep.azimuths, ...sweep.elevations].every(Number.isFinite)
  )
    throw new Error("Invalid title-bounds camera sweep");
  return sweep.elevations.flatMap((elevation) =>
    sweep.azimuths.map((azimuth) => {
      const a = (azimuth * Math.PI) / 180,
        e = (elevation * Math.PI) / 180,
        r = sweep.radius;
      return {
        azimuth,
        elevation,
        eye: {
          x: r * Math.cos(e) * Math.cos(a),
          y: r * Math.cos(e) * Math.sin(a),
          z: r * Math.sin(e),
        },
      };
    }),
  );
}
const data = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");
const inline = (source: string) => source.replace(/<\/script/gi, "<\\/script");
export function nativeHtml(
  bundle: string,
  fixture: Fixture,
  meshes: PreparedAxisText[],
  replacement: PreparedAxisText,
  options: {
    kind: string;
    size: number;
    width: number;
    height: number;
    prepared: boolean;
    figures?: number;
    multiScene?: boolean;
    annotations?: boolean;
  },
  csp?: string,
  mathjax?: string,
): string {
  meshes.forEach((m, i) => validateMesh(m, `labels[${i}]`));
  validateMesh(replacement, "replacement");
  if (
    fixture.schemaVersion !== 1 ||
    meshes.length !== 3 ||
    fixture.labels.some((s, i) => s !== meshes[i]?.source)
  )
    throw new Error("Fixture/mesh mismatch");
  if (
    !fixture.titleSizes.includes(options.size) ||
    !["surface", "curve", "scatter"].includes(options.kind)
  )
    throw new Error("Invalid prototype options");
  const mathHeader = mathjax
    ? `<script>window.MathJax={loader:{paths:{mathjax:'https://mathjax.invalid/',sre:'https://mathjax.invalid/sre',mathmaps:'https://mathjax.invalid/mathmaps'}},startup:{typeset:false},options:{enableMenu:false,enableExplorer:false,enableEnrichment:false,enableSpeech:false,enableBraille:false,menuOptions:{settings:{enrich:false,speech:false,braille:false}}},svg:{fontCache:'none'}};</script><script>${inline(mathjax)}</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('"', "&quot;")}">` : ""}<link rel="icon" href="data:,"><title>Native Plotly math prototype</title><style>body{margin:0;background:white;color:#111;font:16px sans-serif}.figure{width:${options.width}px;height:${options.height}px}#labels{padding:12px}</style>${mathHeader}<script>${inline(bundle)}</script></head><body><div id="plots"></div><div id="labels" aria-label="Axis descriptions"></div><script>
window.__native={ready:false,error:null,revisions:0,mathjaxPresent:typeof MathJax!=='undefined'};
window.addEventListener('error',e=>window.__native.error=e.message);window.addEventListener('unhandledrejection',e=>window.__native.error=String(e.reason));
(async()=>{try{
const fixture=${data(fixture)}, meshes=${data(meshes)}, replacement=${data(replacement)}, options=${data(options)};
const colors=['#e00070','#008050','#3030e0'], axes=['xaxis','yaxis','zaxis'];
if(options.annotations){await MathJax.startup.promise;const mj=MathJax._.mathjax.mathjax,original=mj.document;window.__native.conversions=0;mj.document=function(...args){const doc=original.apply(this,args),convert=doc.convert;doc.convert=function(...values){window.__native.conversions++;return convert.apply(this,values)};return doc};}
const grid=Array.from({length:33},(_,i)=>-2+i/8), us=Array.from({length:129},(_,i)=>i/128*4*Math.PI);
const trace=(phase=0)=>options.kind==='surface'?{type:'surface',x:grid,y:grid,z:grid.map(y=>grid.map(x=>Math.cos(phase)*x*x-y*y)),showscale:false,colorscale:[[0,'#dddddd'],[1,'#777777']]}:options.kind==='curve'?{type:'scatter3d',mode:'lines',x:us.map(u=>Math.cos(u+phase)),y:us.map(u=>Math.sin(u+phase)),z:us.map(u=>u/4-1.5),line:{color:'#555555',width:4}}:{type:'scatter3d',mode:'markers',x:[-1,0,1,0.5],y:[1,0,-1,0.5],z:[-1,0,1,-0.5],marker:{size:5,color:'#555555'}};
const axis=(i)=>({range:i===2?[-4,4]:[-2,2],autorange:false,title:{text:options.annotations?'':fixture.labels[i],font:{size:options.size,color:colors[i],family:'Arial',weight:'normal',style:'normal',variant:'normal'}},tickfont:{color:'#333333'}});
const scene=()=>({annotations:options.annotations?fixture.labels.map((text,i)=>({x:[2,-2,-2][i],y:[-2,2,-2][i],z:[-4,-4,4][i],text,showarrow:false,font:{size:options.size,color:colors[i]}})):[],xaxis:axis(0),yaxis:axis(1),zaxis:axis(2),aspectmode:'cube',camera:{eye:fixture.initialCamera}});
const map=()=>({scene:Object.fromEntries(axes.map((a,i)=>[a,meshes[i]]))});
const plots=[];
for(let f=0;f<(options.figures||1);f++){
 const gd=document.createElement('div');gd.id='plot'+f;gd.className='figure';document.getElementById('plots').appendChild(gd);
 const layout={width:options.width,height:options.height,margin:{l:45,r:45,t:35,b:45},showlegend:false,scene:scene()};
 const config={displayModeBar:false,scrollZoom:true,plotGlPixelRatio:1,typesetMath:!!options.annotations};if(options.prepared)config.preparedAxisText=map();
 let traces=[trace()];
 if(options.multiScene){layout.scene.domain={x:[0,0.48],y:[0,1]};layout.scene2=scene();layout.scene2.domain={x:[0.52,1],y:[0,1]};traces.push({...trace(),scene:'scene2'});if(options.prepared)config.preparedAxisText.scene2=map().scene;}
 await Plotly.newPlot(gd,traces,layout,config);plots.push(gd);
 for(const key of Object.keys(gd._fullLayout).filter(k=>/^scene[0-9]*$/.test(k))){const s=gd._fullLayout[key]._scene,draw=s.drawAnnotations;s.drawAnnotations=function(...args){window.__native.revisions++;return draw.apply(this,args)};}
}
document.getElementById('labels').textContent=meshes.map(m=>m.accessibleText).join('; ');
window.nativeState=()=>({conversions:window.__native.conversions||0,ready:window.__native.ready,error:window.__native.error,revisions:window.__native.revisions,mathjaxPresent:window.__native.mathjaxPresent,view:Array.from(plots[0]._fullLayout.scene._scene.glplot.cameraParams.view),scenes:plots.map(gd=>Object.keys(gd._fullLayout).filter(k=>/^scene[0-9]*$/.test(k)).map(key=>{const a=gd._fullLayout[key]._scene.glplot.axes;return{hashes:(a.preparedLabels||[]).map(m=>m&&m.meshHash),counts:a._text.labelCount,uploads:a._text.preparedUploadCount||0,resolution:[a.gl.drawingBufferWidth,a.gl.drawingBufferHeight],pixelScale:a._text.titleTransforms?a._text.titleTransforms.pixelScale:1,titles:axes.map((axis,i)=>{const adjustment=a._text.titleAdjustments&&a._text.titleAdjustments[i];return adjustment?{...adjustment,fieldPath:key+'.'+axis+'.title',meshHash:a.preparedLabels[i].meshHash}:null})}})),parentAccessBlocked:(()=>{if(parent===window)return false;try{void parent.document;return false}catch{return true}})(),origin:location.origin});
window.nativeCamera=async(eye)=>{await Plotly.relayout(plots[0],{'scene.camera.eye':eye});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return window.nativeState()};
window.nativeAction=async(action)=>{
 const gd=plots[0];
 if(action==='reset')await Plotly.relayout(gd,{'scene.camera':{eye:fixture.initialCamera}});
 if(action==='resize')await Plotly.relayout(gd,{width:450,height:325});
 if(action==='replace'||action==='remove'||action==='react'){
  const layout=JSON.parse(JSON.stringify(gd.layout)), config={...gd._context,preparedAxisText:options.multiScene?{...map(),scene2:map().scene}:map()};
  if(action==='replace'){layout.scene.xaxis.title.text=replacement.source;config.preparedAxisText.scene.xaxis=replacement;}
  if(action==='remove'){layout.scene.xaxis.title.text='';delete config.preparedAxisText.scene.xaxis;}
  if(action==='react')layout.scene.xaxis.title.text=fixture.labels[0];
  await Plotly.react(gd,gd.data,layout,config);
 }
};
window.nativeExport=async(width,height,formats=['png','svg'])=>{const camera=plots[0]._fullLayout.scene._scene.getCamera();await Plotly.relayout(plots[0],{'scene.camera':camera});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const out={};for(const format of formats){const url=await Plotly.toImage(plots[0],{format,width,height});const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,width,height).data;const labels=colors.map(()=>({count:0,minX:width,minY:height,maxX:0,maxY:0}));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=4*(y*width+x),r=rgba[i],g=rgba[i+1],b=rgba[i+2];const k=r>100&&r>2*g&&b>g*1.5?0:g>50&&g>1.8*r&&g>1.4*b?1:b>90&&b>1.8*r&&b>1.8*g?2:-1;if(k>=0){const p=labels[k];p.count++;p.minX=Math.min(p.minX,x);p.minY=Math.min(p.minY,y);p.maxX=Math.max(p.maxX,x);p.maxY=Math.max(p.maxY,y);}}out[format]={url,labels,width,height};}return out};
window.nativeBenchmark=async(steps)=>{
 const intervals=[],updates=[],longTasks=[];let previous=performance.now();
 const observer=typeof PerformanceObserver!=='undefined'?new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))):null;try{observer&&observer.observe({type:'longtask',buffered:false})}catch{}
 const before=window.nativeState();let renderedViewChanges=0,previousView=JSON.stringify(before.view);
 for(let i=0;i<steps;i++){await new Promise(requestAnimationFrame);const currentView=JSON.stringify(window.nativeState().view);if(currentView!==previousView)renderedViewChanges++;previousView=currentView;const now=performance.now();intervals.push(now-previous);previous=now;const angle=i/steps*2*Math.PI;await Promise.all(plots.map(gd=>Plotly.relayout(gd,{'scene.camera.eye':{x:1.8*Math.cos(angle),y:1.8*Math.sin(angle),z:1.2}})));}
 for(let i=0;i<steps;i++){const start=performance.now(),t=trace(i/steps*Math.PI);await Promise.all(plots.map(gd=>Plotly.restyle(gd,{x:[t.x],y:[t.y],z:[t.z]},[0])));updates.push(performance.now()-start);}
 observer&&observer.disconnect();return{intervals,updates,longTasks,renderedViewChanges,before,after:window.nativeState()};
};
window.nativePurge=()=>{const resources=plots.flatMap(gd=>Object.keys(gd._fullLayout).filter(k=>/^scene[0-9]*$/.test(k)).map(k=>gd._fullLayout[k]._scene.glplot.axes));plots.forEach(gd=>Plotly.purge(gd));return{canvases:document.querySelectorAll('.figure canvas').length,axesDisposed:resources.every(a=>a.gl===null&&a._text===null)}};
await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);window.__native.ready=true;
}catch(error){window.__native.error=String(error)}})();
</script></body></html>`;
}

interface TitleFit {
  fieldPath: string;
  meshHash: string;
  fits: boolean;
  angleRadians: number;
  shiftClip: number[];
  inkBoundsClip: number[];
}
interface State {
  ready: boolean;
  error: string | null;
  view: number[];
  scenes: Array<
    Array<{
      hashes: Array<string | null>;
      counts: number[];
      uploads: number;
      resolution: number[];
      pixelScale: number;
      titles: Array<TitleFit | null>;
    }>
  >;
  mathjaxPresent: boolean;
  conversions?: number;
  parentAccessBlocked: boolean;
  origin: string;
}
export function assertTitleFits(state: Pick<State, "error" | "scenes">): void {
  if (state.error) throw new Error(state.error);
  for (const figure of state.scenes)
    for (const scene of figure)
      for (const [i, title] of scene.titles.entries()) {
        const field =
          title?.fieldPath ?? ["xaxis", "yaxis", "zaxis"][i] + ".title";
        if (scene.hashes[i] && !title)
          throw new Error(field + ": missing rendered title bounds");
        if (!title) continue;
        if (!title.fits)
          throw new Error(field + ": title cannot fit the viewport");
        if (title.meshHash !== scene.hashes[i])
          throw new Error(field + ": stale title bounds");
        if (
          title.inkBoundsClip.length !== 4 ||
          title.shiftClip.length !== 2 ||
          ![
            ...title.inkBoundsClip,
            ...title.shiftClip,
            title.angleRadians,
          ].every(Number.isFinite)
        )
          throw new Error(field + ": invalid title bounds");
        const insetX = (4 * scene.pixelScale) / scene.resolution[0]!,
          insetY = (4 * scene.pixelScale) / scene.resolution[1]!;
        const [l, b, r, t] = title.inkBoundsClip;
        if (
          l! < -1 + insetX - 1e-6 ||
          r! > 1 - insetX + 1e-6 ||
          b! < -1 + insetY - 1e-6 ||
          t! > 1 - insetY + 1e-6
        )
          throw new Error(field + ": title bounds leave the viewport");
      }
}
interface ExportData {
  url: string;
  labels: Array<{
    count: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  width: number;
  height: number;
}
interface Benchmark {
  intervals: number[];
  updates: number[];
  longTasks: number[];
  renderedViewChanges: number;
  before: State;
  after: State;
}
const percentile = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};
const summarize = (xs: number[]) => ({
  median: percentile(xs, 0.5),
  p95: percentile(xs, 0.95),
  samples: xs.length,
});
function saveUrl(url: string, file: string): void {
  const payload = url.slice(url.indexOf(",") + 1);
  fs.writeFileSync(
    file,
    url.includes(";base64,")
      ? Buffer.from(payload, "base64")
      : decodeURIComponent(payload),
  );
}
export async function openCase(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  file: string,
  html: string,
  policy: string,
  csp: string,
  dpr: number,
): Promise<{
  page: Page;
  frame: Frame;
  errors: string[];
  network: string[];
  loadMs: number;
}> {
  const outer =
    policy === "app-csp-sandbox"
      ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="icon" href="data:,"><iframe id="frame" sandbox="allow-scripts" style="width:960px;height:1450px;border:0"></iframe><script>document.getElementById('frame').srcdoc=${data(html)}</script>`
      : html;
  fs.writeFileSync(file, outer);
  const page = await browser.newPage();
  await page.setViewport({ width: 980, height: 1500, deviceScaleFactor: dpr });
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setOfflineMode(true);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (
      r.url() === pathToFileURL(file).href ||
      /^(data:|blob:|about:)/.test(r.url())
    )
      void r.continue();
    else {
      network.push(r.url());
      void r.abort();
    }
  });
  const start = performance.now();
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  const frame =
    policy === "app-csp-sandbox"
      ? await (await page.waitForSelector("#frame"))!.contentFrame()
      : page.mainFrame();
  if (!frame) throw new Error("Missing sandbox frame");
  await frame.waitForFunction(
    "window.__native && (window.__native.ready || window.__native.error)",
    { timeout: 30000 },
  );
  const error = await frame.evaluate("window.__native.error");
  if (error) {
    await page.close();
    throw new Error(String(error));
  }
  return { page, frame, errors, network, loadMs: performance.now() - start };
}
export async function runNativeProbe(
  buildDir: string,
  out: string,
): Promise<boolean> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out);
  fs.copyFileSync(
    fileURLToPath(import.meta.url),
    path.join(out, "runner-source.ts.txt"),
  );
  fs.copyFileSync(
    new URL("./prepare-mesh.ts", import.meta.url),
    path.join(out, "mesh-adapter-source.ts.txt"),
  );
  const report: {
    schemaVersion: 1;
    source: unknown;
    runner: unknown;
    hardware: unknown;
    browser?: string;
    assets?: unknown;
    geometry: unknown[];
    cases: unknown[];
    performance: unknown[];
    cameraSweep: unknown[];
    errors: string[];
    notTested: string[];
    passed?: boolean;
  } = {
    schemaVersion: 1,
    source: readSourceLock(),
    runner: {
      probeSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      adapterSha256: sha256(
        fs.readFileSync(new URL("./prepare-mesh.ts", import.meta.url)),
      ),
      fixtureSha256: sha256(
        fs.readFileSync(
          path.join(
            root,
            "tests/fixtures/visualization/plotly-native-math.json",
          ),
        ),
      ),
    },
    hardware: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memory: os.totalmem(),
      node: process.version,
    },
    geometry: [],
    cases: [],
    performance: [],
    cameraSweep: [],
    errors: [],
    notTested: [
      "Tauri/WebView",
      "actual browser-worker/host adapter",
      "product animation budgets",
      "custom math ticks",
      "general font variants",
    ],
  };
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    const lock = readSourceLock(),
      manifest = JSON.parse(
        fs.readFileSync(path.join(buildDir, "native-math-build.json"), "utf8"),
      );
    if (manifest.source.plotly.commit !== lock.plotly.commit)
      throw new Error("Build source mismatch");
    for (const [name, hash] of Object.entries(lock.patches))
      if (manifest.source.patches[name] !== hash)
        throw new Error("Build patch mismatch");
    for (const asset of Object.values(manifest.assets) as Array<{
      file: string;
      sha256: string;
    }>)
      verifyFile(path.join(buildDir, "dist", asset.file), asset.sha256);
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(root, "tests/fixtures/visualization/plotly-native-math.json"),
        "utf8",
      ),
    ) as Fixture;
    const meshes: PreparedAxisText[] = [];
    for (const [i, label] of fixture.corpus.entries()) {
      const e = await prepareWithEvidence(
        label,
        `corpus[${i}]`,
        path.join(buildDir, "stackgl_modules"),
      );
      saveMeshEvidence(e, path.join(out, `geometry-${i}`));
      report.geometry.push({
        source: label,
        hash: e.mesh.meshHash,
        iou: e.coverage.iou,
        holes: e.coverage.holes,
        filledHolePixels: e.coverage.filledHolePixels,
        holeBoundaryDifferences: e.coverage.holeBoundaryDifferences,
        vertices: e.mesh.positions.length,
        triangles: e.mesh.cells.length,
        ms: e.preparationMs,
      });
      if (e.coverage.iou < 0.98 || e.coverage.filledHolePixels !== 0)
        throw new Error(`Geometry gate failed: ${label}`);
      if (i < 3) meshes.push(e.mesh);
    }
    const replacement = (
      await prepareWithEvidence(
        "$x^3$",
        "replacement",
        path.join(buildDir, "stackgl_modules"),
      )
    ).mesh;
    // Verify the serialized boundary before embedding; the fork's synchronous
    // scene bridge validates geometry/source and never executes teacher code.
    const loaded = JSON.parse(JSON.stringify(meshes)) as PreparedAxisText[];
    loaded.forEach((m, i) => validateMesh(m, `serialized[${i}]`));
    const preparationRuns = [];
    for (let repetition = 0; repetition < fixture.repetitions; repetition++) {
      const started = performance.now();
      for (const [i, label] of fixture.labels.entries())
        await prepareAxisText(
          label,
          `preparation[${i}]`,
          path.join(buildDir, "stackgl_modules"),
        );
      preparationRuns.push(performance.now() - started);
    }
    report.performance.push({
      id: "prepare-three-labels",
      runsMs: preparationRuns,
      summary: summarize(preparationRuns),
      cache:
        "Existing typesetter glyph cache warm; contour conversion repeated per sample",
    });
    const preparedBefore = { ...preparationCounters };
    const bundles = {
      native: fs.readFileSync(
        path.join(buildDir, "dist/plotly-native-math.min.js"),
        "utf8",
      ),
      baseline: fs.readFileSync(
        path.join(buildDir, "dist/plotly-baseline.min.js"),
        "utf8",
      ),
    };
    report.assets = {
      native: describeAsset(
        path.join(buildDir, "dist/plotly-native-math.min.js"),
      ),
      baseline: describeAsset(
        path.join(buildDir, "dist/plotly-baseline.min.js"),
      ),
      meshBytes: Buffer.byteLength(JSON.stringify(meshes)),
      browserMathJaxBytes: 0,
    };
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH ??
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      pipe: true,
      userDataDir: fs.mkdtempSync(
        path.join(os.tmpdir(), "lh-native-math-browser-"),
      ),
    });
    report.browser = await browser.version();
    const mathjax = fs.readFileSync(
      path.join(
        root,
        "node_modules/@mathjax/mathjax-tex-font/tex-mml-svg-mathjax-tex.js",
      ),
      "utf8",
    );
    const csp = JSON.parse(
      fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
    ).app.security.csp as string;
    for (const policy of ["plain", "app-csp", "app-csp-sandbox"])
      for (const kind of ["surface", "curve", "scatter"])
        for (const size of fixture.titleSizes)
          for (const [width, height] of fixture.viewports)
            for (const dpr of fixture.devicePixelRatios) {
              const id = `${policy}-${kind}-${size}-${width}-${dpr}`;
              const result: {
                id: string;
                passed: boolean;
                error?: string;
                initial?: unknown;
                exports?: unknown;
                actions?: unknown;
                purge?: unknown;
                errors?: string[];
                network?: string[];
                loadMs?: number;
                cameraUploadsDelta?: number;
              } = { id, passed: false };
              let opened: Awaited<ReturnType<typeof openCase>> | undefined;
              try {
                opened = await openCase(
                  browser,
                  path.join(out, id + ".html"),
                  nativeHtml(
                    bundles.native,
                    fixture,
                    loaded,
                    replacement,
                    {
                      kind,
                      size,
                      width: width!,
                      height: height!,
                      prepared: true,
                    },
                    policy === "plain" ? undefined : csp,
                  ),
                  policy,
                  csp,
                  dpr,
                );
                const { page, frame, errors, network } = opened;
                const initial = (await frame.evaluate(
                  "window.nativeState()",
                )) as State;
                if (
                  !initial.scenes[0]![0]!.uploads ||
                  initial.scenes[0]![0]!.counts.some(
                    (count, i) => count !== meshes[i]!.cells.length * 3,
                  )
                )
                  throw new Error(
                    "Native title buffers do not match prepared triangles",
                  );
                assertTitleFits(initial);
                result.initial = initial;
                result.loadMs = opened.loadMs;
                if (
                  initial.mathjaxPresent ||
                  initial.scenes[0]![0]!.hashes.filter(Boolean).length !== 3
                )
                  throw new Error(
                    "Missing native meshes or unexpected MathJax",
                  );
                if (
                  policy === "app-csp-sandbox" &&
                  !initial.parentAccessBlocked
                )
                  throw new Error("Opaque sandbox did not block parent");
                const prior = JSON.stringify(initial.view);
                await page.mouse.move(width! * 0.45, height! * 0.45);
                await page.mouse.down();
                await page.mouse.move(width! * 0.65, height! * 0.55, {
                  steps: 20,
                });
                await page.mouse.up();
                await frame.waitForFunction(
                  `JSON.stringify(window.nativeState().view)!==${data(prior)}`,
                  { timeout: 10000 },
                );
                const beforeZoom = (await frame.evaluate(
                  "JSON.stringify(window.nativeState().view)",
                )) as string;
                await page.mouse.wheel({ deltaY: 160 });
                await frame.waitForFunction(
                  `JSON.stringify(window.nativeState().view)!==${data(beforeZoom)}`,
                  { timeout: 10000 },
                );
                const dragged = (await frame.evaluate(
                  "window.nativeState()",
                )) as State;
                assertTitleFits(dragged);
                result.cameraUploadsDelta =
                  dragged.scenes[0]![0]!.uploads -
                  initial.scenes[0]![0]!.uploads;
                if (
                  JSON.stringify(dragged.scenes[0]![0]!.hashes) !==
                  JSON.stringify(initial.scenes[0]![0]!.hashes)
                )
                  throw new Error("Camera replaced prepared geometry");
                const exports: Array<{
                  format: string;
                  width: number;
                  height: number;
                  labels: ExportData["labels"];
                }> = [];
                result.exports = exports;
                for (const [ew, eh] of [
                  [width!, height!],
                  [1800, 1300],
                ]) {
                  const images = (await frame.evaluate(
                    `window.nativeExport(${ew},${eh})`,
                  )) as Record<string, ExportData>;
                  for (const [format, image] of Object.entries(images)) {
                    saveUrl(image.url, path.join(out, `${id}-${ew}.${format}`));
                    exports.push({
                      format,
                      width: ew!,
                      height: eh!,
                      labels: image.labels,
                    });
                    if (image.labels.some((p) => p.count === 0))
                      throw new Error(
                        `Raw ${format} export omitted a colored title`,
                      );
                  }
                }
                result.exports = exports;
                await page.screenshot({ path: path.join(out, id + ".png") });
                const actions = [];
                for (const action of [
                  "reset",
                  "resize",
                  "replace",
                  "remove",
                  "react",
                ]) {
                  await frame.evaluate(`window.nativeAction(${data(action)})`);
                  await frame.evaluate(
                    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
                  );
                  const state = (await frame.evaluate(
                    "window.nativeState()",
                  )) as State;
                  assertTitleFits(state);
                  actions.push({ action, state });
                  const x = state.scenes[0]![0]!.hashes[0];
                  if (action === "replace" && x !== replacement.meshHash)
                    throw new Error("Stale replacement mesh");
                  if (action === "remove" && x)
                    throw new Error("Removed mesh retained");
                  if (action === "react" && x !== meshes[0]!.meshHash)
                    throw new Error("Mesh not restored");
                }
                result.actions = actions;
                const purge = (await frame.evaluate(
                  "window.nativePurge()",
                )) as { axesDisposed: boolean; canvases: number };
                result.purge = purge;
                if (!purge.axesDisposed || purge.canvases)
                  throw new Error("Purge retained axes/canvas");
                result.errors = errors;
                result.network = network;
                if (errors.length || network.length)
                  throw new Error("Page/network errors");
                result.passed = true;
              } catch (e) {
                result.error = String(e);
                report.errors.push(id + ": " + String(e));
              } finally {
                await opened?.page.close();
              }
              report.cases.push(result);
              console.log(id, result.passed ? "PASS" : result.error);
              fs.writeFileSync(
                path.join(out, "results.json"),
                JSON.stringify(report, null, 2),
              );
            }
    // Independent figure and multi-scene isolation, before the timing loops.
    for (const multiScene of [false, true]) {
      const id = multiScene ? "multi-scene" : "two-figures";
      const c = await openCase(
        browser,
        path.join(out, id + ".html"),
        nativeHtml(bundles.native, fixture, loaded, replacement, {
          kind: "surface",
          size: 20,
          width: 900,
          height: 650,
          prepared: true,
          figures: multiScene ? 1 : 2,
          multiScene,
        }),
        "plain",
        csp,
        1,
      );
      const before = (await c.frame.evaluate("window.nativeState()")) as State;
      await c.frame.evaluate('window.nativeAction("replace")');
      const after = (await c.frame.evaluate("window.nativeState()")) as State;
      assertTitleFits(before);
      assertTitleFits(after);
      const other = multiScene ? after.scenes[0]![1]! : after.scenes[1]![0]!;
      if (other.hashes[0] !== meshes[0]!.meshHash)
        throw new Error("Cross-scene/figure contamination");
      const purge = (await c.frame.evaluate("window.nativePurge()")) as {
        axesDisposed: boolean;
      };
      if (!purge.axesDisposed) throw new Error("Isolation purge failed");
      report.cases.push({ id, before, after, purge, passed: true });
      await c.page.close();
    }
    const sweep = fixture.titleBoundsSweep;
    const sweepCameras = titleSweepCameras(sweep);
    for (const kind of ["surface", "curve", "scatter"]) {
      const opened = await openCase(
        browser,
        path.join(out, `sweep-${kind}.html`),
        nativeHtml(
          bundles.native,
          fixture,
          loaded,
          replacement,
          {
            kind,
            size: sweep.size,
            width: sweep.viewport[0]!,
            height: sweep.viewport[1]!,
            prepared: true,
          },
          csp,
        ),
        sweep.policy,
        csp,
        sweep.devicePixelRatio,
      );
      try {
        const initial = (await opened.frame.evaluate(
          "window.nativeState()",
        )) as State;
        assertTitleFits(initial);
        for (const pose of sweepCameras) {
          const id = `sweep-${kind}-e${pose.elevation}-a${pose.azimuth}`;
          const observation: {
            id: string;
            eye: typeof pose.eye;
            passed: boolean;
            state?: State;
            exports?: unknown[];
            error?: string;
            cameraUploadsDelta?: number;
          } = { id, eye: pose.eye, passed: false };
          try {
            const state = (await opened.frame.evaluate(
              `window.nativeCamera(${data(pose.eye)})`,
            )) as State;
            observation.state = state;
            assertTitleFits(state);
            if (
              JSON.stringify(state.scenes[0]![0]!.hashes) !==
              JSON.stringify(initial.scenes[0]![0]!.hashes)
            )
              throw new Error("Camera sweep replaced prepared meshes");
            observation.cameraUploadsDelta =
              state.scenes[0]![0]!.uploads - initial.scenes[0]![0]!.uploads;
            const endpoint =
              pose.azimuth === sweep.azimuths[0] ||
              pose.azimuth === sweep.azimuths.at(-1);
            const exports: unknown[] = [];
            observation.exports = exports;
            const sizes: Array<[number, number, string[]]> = [
              [
                sweep.viewport[0]!,
                sweep.viewport[1]!,
                endpoint ? ["png", "svg"] : ["png"],
              ],
            ];
            if (endpoint) sizes.push([1800, 1300, ["png"]]);
            for (const [width, height, formats] of sizes) {
              const images = (await opened.frame.evaluate(
                `window.nativeExport(${width},${height},${data(formats)})`,
              )) as Record<string, ExportData>;
              for (const [format, image] of Object.entries(images)) {
                const filename = `${id}-${width}.${format}`;
                saveUrl(image.url, path.join(out, filename));
                exports.push({
                  filename,
                  format,
                  width,
                  height,
                  labels: image.labels,
                });
                if (image.labels.some((p) => p.count === 0))
                  throw new Error(
                    `Raw ${format} sweep export omitted a colored title`,
                  );
              }
            }
            if (opened.errors.length || opened.network.length)
              throw new Error("Sweep page/network errors");
            observation.passed = true;
          } catch (error) {
            observation.error = String(error);
            report.errors.push(id + ": " + String(error));
          }
          report.cameraSweep.push(observation);
          console.log(id, observation.passed ? "PASS" : observation.error);
          fs.writeFileSync(
            path.join(out, "results.json"),
            JSON.stringify(report, null, 2),
          );
        }
        const purge = (await opened.frame.evaluate("window.nativePurge()")) as {
          axesDisposed: boolean;
          canvases: number;
        };
        if (!purge.axesDisposed || purge.canvases)
          throw new Error("Sweep purge retained resources");
      } finally {
        await opened.page.close();
      }
    }
    for (const kind of ["surface", "curve", "scatter"])
      for (const figures of [1, 2])
        for (const mode of ["baseline", "native", "annotations"] as const) {
          const id = `perf-${mode}-${kind}-${figures}`;
          const runs = [];
          for (
            let repetition = -1;
            repetition < fixture.repetitions;
            repetition++
          ) {
            const c = await openCase(
              browser,
              path.join(out, id + ".html"),
              nativeHtml(
                mode === "annotations" ? bundles.baseline : bundles[mode],
                fixture,
                loaded,
                replacement,
                {
                  kind,
                  size: 20,
                  width: 900,
                  height: 650,
                  prepared: mode === "native",
                  annotations: mode === "annotations",
                  figures,
                },
                undefined,
                mode === "annotations" ? mathjax : undefined,
              ),
              "plain",
              csp,
              1,
            );
            const r = (await c.frame.evaluate(
              `window.nativeBenchmark(${fixture.steps})`,
            )) as Benchmark;
            assertTitleFits(r.before);
            assertTitleFits(r.after);
            if (c.errors.length || c.network.length)
              throw new Error(`${id}: performance page errors`);
            if (r.renderedViewChanges === 0)
              throw new Error(`${id}: camera was not rendered`);
            if (repetition >= 0)
              runs.push({
                loadMs: c.loadMs,
                renderedViewChanges: r.renderedViewChanges,
                frameMs: summarize(r.intervals),
                updateMs: summarize(r.updates),
                longTasks: r.longTasks,
                before: r.before,
                after: r.after,
              });
            await c.frame.evaluate("window.nativePurge()");
            await c.page.close();
          }
          report.performance.push({ id, warmup: 1, runs });
          console.log(id, "measured");
          fs.writeFileSync(
            path.join(out, "results.json"),
            JSON.stringify(report, null, 2),
          );
        }
    if (
      preparationCounters.typeset !== preparedBefore.typeset ||
      preparationCounters.contour !== preparedBefore.contour
    )
      throw new Error("Repeated preparation during interaction");
    report.passed = report.errors.length === 0;
  } catch (e) {
    report.errors.push(String(e));
    report.passed = false;
  } finally {
    await browser?.close();
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(report, null, 2),
    );
    const cards = report.cases
      .map((c) => {
        const r = c as { id: string; passed: boolean };
        const screenshot = fs.existsSync(path.join(out, r.id + ".png"))
          ? r.id + ".png"
          : fs.existsSync(path.join(out, r.id + "-450.png"))
            ? r.id + "-450.png"
            : null;
        return `<li>${r.id}: ${r.passed ? "PASS" : "FAIL"} <a href="${r.id}.html">HTML</a>${screenshot ? ` <a href="${screenshot}">image</a>` : ""}</li>`;
      })
      .join("");
    const sweepCards = report.cameraSweep
      .map((value) => {
        const r = value as {
          id: string;
          passed: boolean;
          exports?: Array<{ filename: string }>;
        };
        return `<li>${r.id}: ${r.passed ? "PASS" : "FAIL"} ${(r.exports ?? []).map((e) => `<a href="${e.filename}">${e.filename}</a>`).join(" ")}</li>`;
      })
      .join("");
    fs.writeFileSync(
      path.join(out, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Plotly native math review</title><h1>Native math prototype: ${report.passed ? "PASS" : "FAIL"}</h1><p><a href="results.json">Full evidence</a>. Product integration, WebView and worker/host remain untested.</p><h2>Original runtime matrix</h2><ul>${cards}</ul><h2>Deterministic camera sweep</h2><ul>${sweepCards}</ul>`,
    );
  }
  return report.passed ?? false;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const b = process.argv.indexOf("--build-dir"),
    o = process.argv.indexOf("--out");
  if (b < 0 || o < 0 || !process.argv[b + 1] || !process.argv[o + 1])
    throw new Error(
      "Usage: probe.ts --build-dir <verified-build> --out <fresh-directory>",
    );
  process.exitCode = (await runNativeProbe(
    path.resolve(process.argv[b + 1]!),
    path.resolve(process.argv[o + 1]!),
  ))
    ? 0
    : 1;
}
