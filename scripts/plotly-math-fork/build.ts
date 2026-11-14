import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { sha256 } from "./contracts.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
export interface SourceLock {
  schemaVersion: 1;
  plotly: { repository: string; tag: string; commit: string };
  packages: Record<
    string,
    { version: string; gitHead: string; tarball: string; integrity: string }
  >;
  preimages: Record<string, string>;
  patches: Record<string, string>;
  labelHelperSha256: string;
  glslToolsLockSha256: string;
}
export function readSourceLock(): SourceLock {
  return JSON.parse(
    fs.readFileSync(path.join(here, "sources.lock.json"), "utf8"),
  ) as SourceLock;
}
export function verifyFile(file: string, expected: string): void {
  if (sha256(fs.readFileSync(file)) !== expected)
    throw new Error(`Source/hash mismatch: ${file}`);
}
export async function command(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}
export const describeAsset = (file: string) => {
  const b = fs.readFileSync(file);
  return {
    file: path.basename(file),
    sha256: sha256(b),
    bytes: b.length,
    gzipBytes: gzipSync(b).length,
  };
};
export async function checkPatchedSource(workDir: string): Promise<void> {
  const plotlyFiles = [
    "src/plot_api/plot_config.js",
    "src/plots/gl3d/scene.js",
    "src/plots/gl3d/prepared_text.js",
    "esbuild-config.js",
    "tasks/util/inline_css.js",
  ];
  const vendorFiles = [
    "stackgl_modules/vendor/gl-axes3d/axes.js",
    "stackgl_modules/vendor/gl-axes3d/lib/text.js",
    "stackgl_modules/vendor/gl-axes3d/lib/title-bounds.js",
    "stackgl_modules/webpack.config.js",
  ];
  const configDir = path.join(workDir, "native-math-checks");
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(
    path.join(here, "biome.json"),
    path.join(configDir, "biome.json"),
  );
  const biome = path.join(workDir, "node_modules/.bin/biome");
  for (const verb of ["lint", "format"]) {
    await command(biome, [verb, ...plotlyFiles], workDir);
    await command(
      biome,
      [verb, `--config-path=${configDir}`, ...vendorFiles],
      workDir,
    );
  }
  await command("npm", ["run", "typecheck"], workDir);
  fs.writeFileSync(
    path.join(configDir, "boundaries.d.ts"),
    "declare var process: { global: Record<string, any> };\ninterface Window { __TEXT_CACHE?: Record<string, any>; }\ndeclare var __dirname: string;\ndeclare module '*to_image_attributes' { const boundary: any; export = boundary; }\ndeclare module 'path' { const boundary: any; export = boundary; }\ndeclare module 'fs' { const boundary: any; export = boundary; }\ndeclare module 'crypto' { const boundary: any; export = boundary; }\ndeclare module 'esbuild-plugin-environment' { export function environmentPlugin(options: any): any; }\ndeclare module 'esbuild-plugin-glsl' { export function glsl(options: any): any; }\n",
  );
  const config = JSON.parse(
    fs.readFileSync(path.join(here, "tsconfig.checkjs.json"), "utf8"),
  );
  config.compilerOptions.noResolve = true;
  config.files = [...plotlyFiles, ...vendorFiles]
    .map((p) => path.join(workDir, p))
    .concat(path.join(configDir, "boundaries.d.ts"));
  const configPath = path.join(configDir, "tsconfig.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  await command(
    path.join(workDir, "node_modules/.bin/tsc"),
    ["--noEmit", "-p", configPath],
    workDir,
  );
  for (const p of [...plotlyFiles, ...vendorFiles])
    await command(process.execPath, ["--check", p], workDir);
  const tools = path.join(configDir, "tools");
  fs.mkdirSync(tools, { recursive: true });
  const toolLockPath = path.join(here, "glsl-tools-package-lock.json");
  verifyFile(toolLockPath, readSourceLock().glslToolsLockSha256);
  const toolLock = JSON.parse(fs.readFileSync(toolLockPath, "utf8"));
  fs.copyFileSync(toolLockPath, path.join(tools, "package-lock.json"));
  fs.writeFileSync(
    path.join(tools, "package.json"),
    JSON.stringify(
      { private: true, dependencies: toolLock.packages[""].dependencies },
      null,
      2,
    ),
  );
  await command("npm", ["ci"], tools);
  await command(
    path.join(tools, "node_modules/.bin/prettier"),
    [
      "--plugin=prettier-plugin-glsl",
      "--check",
      path.join(
        workDir,
        "stackgl_modules/vendor/gl-axes3d/lib/shaders/textVert.glsl",
      ),
    ],
    tools,
  );
  verifyFile(
    path.join(tools, "package-lock.json"),
    readSourceLock().glslToolsLockSha256,
  );
}
export async function buildFork(workDir: string): Promise<void> {
  if (fs.existsSync(workDir))
    throw new Error(`Refusing existing work directory: ${workDir}`);
  const lock = readSourceLock();
  verifyFile(
    fileURLToPath(new URL("../../src/agent/plot-labels.ts", import.meta.url)),
    lock.labelHelperSha256,
  );
  for (const [name, hash] of Object.entries(lock.patches))
    verifyFile(path.join(here, "patches", name), hash);
  if (Object.keys(lock.patches).length !== 5)
    throw new Error("Expected five reviewed patches");
  fs.mkdirSync(path.dirname(workDir), { recursive: true });
  await command(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      lock.plotly.tag,
      lock.plotly.repository,
      workDir,
    ],
    path.dirname(workDir),
  );
  verifyFile(
    path.join(workDir, ".git/HEAD"),
    sha256(lock.plotly.commit + "\n"),
  );
  try {
    for (const [name, hash] of Object.entries(lock.preimages))
      if (!name.includes("/vendor/"))
        verifyFile(path.join(workDir, name), hash);
    await command("npm", ["ci"], workDir);
    await command("npm", ["ci", "--prefix", "stackgl_modules"], workDir);
    const vendor = path.join(workDir, "stackgl_modules/vendor/gl-axes3d");
    fs.mkdirSync(vendor, { recursive: true });
    for (const [name, meta] of Object.entries(lock.packages)) {
      const response = await fetch(meta.tarball);
      if (!response.ok)
        throw new Error(`Download failed ${response.status}: ${name}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        "sha512-" + createHash("sha512").update(bytes).digest("base64") !==
        meta.integrity
      )
        throw new Error(`Tarball integrity mismatch: ${name}`);
      const archive = path.join(workDir, `${name}.tgz`);
      fs.writeFileSync(archive, bytes);
      if (name === "gl-axes3d")
        await command(
          "tar",
          ["-xzf", archive, "-C", vendor, "--strip-components=1"],
          workDir,
        );
      else {
        const installed = path.join(
          workDir,
          "stackgl_modules/node_modules",
          name,
          "package.json",
        );
        const pkg = JSON.parse(fs.readFileSync(installed, "utf8")) as {
          version: string;
        };
        if (pkg.version !== meta.version)
          throw new Error(`Wrong installed ${name}`);
      }
    }
    for (const [name, hash] of Object.entries(lock.preimages))
      if (name.includes("/vendor/")) verifyFile(path.join(workDir, name), hash);
    const cssPatch = path.join(here, "patches/plotly-deterministic-css.patch");
    await command("git", ["apply", "--check", cssPatch], workDir);
    await command("git", ["apply", cssPatch], workDir);
    await command(
      "npm",
      ["run", "bundle-stackgl", "--prefix", "stackgl_modules"],
      workDir,
    );
    await command("npm", ["run", "preprocess"], workDir);
    await command(
      "npm",
      [
        "run",
        "custom-bundle",
        "--",
        "--traces",
        "surface,scatter3d",
        "--out",
        "baseline",
      ],
      workDir,
    );
    for (const name of [
      "plotly-prepared-axis-text.patch",
      "gl-axes3d-prepared-titles.patch",
      "plotly-stackgl-alias.patch",
      "gl-axes3d-title-bounds.patch",
    ])
      await command(
        "git",
        ["apply", "--check", path.join(here, "patches", name)],
        workDir,
      ).then(() =>
        command("git", ["apply", path.join(here, "patches", name)], workDir),
      );
    await checkPatchedSource(workDir);
    await command(
      "npm",
      ["run", "bundle-stackgl", "--prefix", "stackgl_modules"],
      workDir,
    );
    await command(
      "npm",
      [
        "run",
        "custom-bundle",
        "--",
        "--traces",
        "surface,scatter3d",
        "--out",
        "native-math",
      ],
      workDir,
    );
    for (const [name, hash] of Object.entries(lock.preimages))
      if (name.endsWith("package-lock.json"))
        verifyFile(path.join(workDir, name), hash);
    if (
      !fs
        .readFileSync(
          path.join(workDir, "dist/plotly-native-math.min.js"),
          "utf8",
        )
        .includes("preparedUploadCount")
    )
      throw new Error("Built distribution lacks native mesh path");
    fs.writeFileSync(
      path.join(workDir, "native-math-build.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          source: lock,
          node: process.version,
          npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
          assets: {
            baseline: describeAsset(
              path.join(workDir, "dist/plotly-baseline.min.js"),
            ),
            native: describeAsset(
              path.join(workDir, "dist/plotly-native-math.min.js"),
            ),
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(workDir, "native-math-build-error.json"),
      JSON.stringify({ error: String(error), source: lock }, null, 2),
    );
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const i = process.argv.indexOf("--work-dir");
  if (i < 0 || !process.argv[i + 1])
    throw new Error("Usage: build.ts --work-dir <fresh-directory>");
  await buildFork(path.resolve(process.argv[i + 1]!));
}
