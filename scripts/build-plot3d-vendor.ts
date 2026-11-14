import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readSourceLock, verifyFile } from "./plotly-math-fork/build.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const build = path.resolve(
  process.argv[process.argv.indexOf("--build-dir") + 1] || "",
);
if (!process.argv.includes("--build-dir"))
  throw new Error(
    "Pass --build-dir pointing to a verified five-patch clean build",
  );
const sha = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const lock = readSourceLock();
for (const [file, hash] of Object.entries(lock.patches))
  verifyFile(path.join(root, "scripts/plotly-math-fork/patches", file), hash);
const built = JSON.parse(
  fs.readFileSync(path.join(build, "native-math-build.json"), "utf8"),
);
if (JSON.stringify(built.source) !== JSON.stringify(lock))
  throw new Error("Build source lock mismatch");
const native = fs.readFileSync(
  path.join(build, "dist/plotly-native-math.min.js"),
  "utf8",
);
if (
  sha(native) !==
  "f98d655a082b44857e6349aadeb91e385909866477da8c3206a78471e854497e"
)
  throw new Error("Unverified native bundle");
const stack = path.join(build, "stackgl_modules");
verifyFile(
  path.join(stack, "package-lock.json"),
  lock.preimages["stackgl_modules/package-lock.json"]!,
);
const vtext = path.join(stack, "node_modules/vectorize-text/lib/vtext.js");
const sourceHash =
  "cd0bdafb392088823b62eb97ae209b5d3e51c8b24f03e78cd6e8c35e8ba1ad8b";
verifyFile(vtext, sourceHash);
const source = fs.readFileSync(vtext, "utf8");
function section(start: string, end: string) {
  const a = source.indexOf(start),
    b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0)
    throw new Error(`Extraction boundary mismatch: ${start}`);
  return source.slice(a, b);
}
const entry = `var originPixels=[0,0];var surfaceNets=require('surface-nets'),ndarray=require('ndarray'),simplify=require('simplify-planar-graph'),cleanPSLG=require('clean-pslg'),cdt2d=require('cdt2d'),toPolygonCrappy=require('planar-graph-to-polyline');\n${section("function transformPositions(", "function getPixels(").replace("return positions.map", "originPixels=[-xShift,-yShift];return positions.map")}\n${section("function getContour(", "function vectorizeText(")}\nexport function contour(alpha,width,height){const mesh=processPixels(ndarray(alpha,[width,height],[1,width]),{triangles:true,textAlign:'center',textBaseline:'middle'},256);return {...mesh,originPixels};}`;
const require = createRequire(path.join(build, "package.json"));
const esbuild = require("esbuild") as typeof import("esbuild");
if (esbuild.version !== "0.28.2") throw new Error("Unexpected esbuild version");
const bundled = await esbuild.build({
  stdin: {
    contents: entry,
    resolveDir: stack,
    sourcefile: "contour-entry.js",
    loader: "js",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  metafile: true,
  write: false,
  absWorkingDir: stack,
});
const converter = bundled.outputFiles![0]!.text;
const inputs = Object.keys(bundled.metafile!.inputs)
  .filter((p) => p !== "contour-entry.js" && !p.startsWith("(disabled):"))
  .sort();
const licenseDirs = new Set<string>([
  build,
  stack,
  path.join(stack, "node_modules/vectorize-text"),
  path.join(stack, "vendor/gl-axes3d"),
]);
for (const input of inputs) {
  let dir = path.dirname(path.resolve(stack, input));
  while (
    dir.startsWith(stack) &&
    !fs.existsSync(path.join(dir, "package.json"))
  )
    dir = path.dirname(dir);
  if (fs.existsSync(path.join(dir, "package.json"))) licenseDirs.add(dir);
}
// Include the runtime dependency closures of both maintained build workspaces.
const queue = [...licenseDirs];
for (let index = 0; index < queue.length; index++) {
  const dir = queue[index]!;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    let parent = dir,
      found: string | undefined;
    while (parent.startsWith(build)) {
      const candidate = path.join(parent, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        found = candidate;
        break;
      }
      parent = path.dirname(parent);
    }
    if (!found)
      throw new Error(`Missing license dependency: ${pkg.name} → ${name}`);
    if (!licenseDirs.has(found)) {
      licenseDirs.add(found);
      queue.push(found);
    }
  }
}
const notices = [...licenseDirs]
  .sort((a, b) =>
    path.relative(build, a).localeCompare(path.relative(build, b)),
  )
  .map((dir) => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const files = fs
      .readdirSync(dir)
      .filter(
        (f) =>
          /^(licen[sc]e|copying|notice)(\.|$)/i.test(f) &&
          fs.statSync(path.join(dir, f)).isFile(),
      );
    return `===== ${pkg.name}@${pkg.version} (${JSON.stringify(pkg.license ?? "see notice")}) =====\n${files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n")}`;
  })
  .join("\n\n");
const manifest = {
  schemaVersion: 1,
  source: lock,
  node: built.node,
  npm: built.npm,
  recipe: "canvas-free-vtext-3.2.2-v2",
  sourceHash,
  esbuild: esbuild.version,
  stackglLockSha256: lock.preimages["stackgl_modules/package-lock.json"],
  stackglLock: JSON.parse(
    fs.readFileSync(path.join(stack, "package-lock.json"), "utf8"),
  ),
  plotly: { sha256: sha(native), bytes: Buffer.byteLength(native) },
  contour: { sha256: sha(converter), bytes: Buffer.byteLength(converter) },
  inputs: inputs.map((p) => ({
    path: p,
    sha256: sha(fs.readFileSync(path.resolve(stack, p))),
  })),
};
const outputs: Record<string, string> = {
  "plotly-source.json": JSON.stringify(native) + "\n",
  "contour.mjs": converter,
  "contour.d.mts":
    "export function contour(alpha: Uint8Array, width: number, height: number): {positions: Array<[number, number]>; cells: Array<[number, number, number]>; originPixels: [number, number]};\n",
  "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  "LICENSES.txt": notices + "\n",
  "licenses.json": JSON.stringify(notices) + "\n",
};
const dest = path.join(root, "src/vendor/plotly-native-math");
fs.mkdirSync(dest, { recursive: true });
for (const [file, data] of Object.entries(outputs)) {
  const out = path.join(dest, file);
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(out, "utf8") !== data)
      throw new Error(`Generated vendor drift: ${file}`);
  } else fs.writeFileSync(out, data);
}
console.log(
  JSON.stringify({
    checked: process.argv.includes("--check"),
    plotly: manifest.plotly,
    contour: manifest.contour,
    files: Object.keys(outputs),
  }),
);
