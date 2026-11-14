import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { typesetPlotLabel } from "../../src/agent/plot-labels.ts";
import {
  LIMITS,
  RECIPE,
  meshDigest,
  validateMesh,
  type PreparedAxisText,
} from "./contracts.ts";

type Mesh = Pick<PreparedAxisText, "positions" | "cells">;
export interface Coverage {
  iou: number;
  holes: number;
  filledHolePixels: number;
  holeBoundaryDifferences: number;
  reference: Buffer;
  actual: Buffer;
  diff: Buffer;
}
export interface MeshEvidence {
  mesh: PreparedAxisText;
  raster: { width: number; height: number; alpha: Uint8Array };
  coverage: Coverage;
  preparationMs: number;
}
export const preparationCounters = { typeset: 0, contour: 0 };

function converter(stackglRoot: string) {
  const require = createRequire(path.join(stackglRoot, "package.json"));
  for (const [name, version] of [
    ["vectorize-text", "3.2.2"],
    ["ndarray", "1.1.0"],
  ]) {
    const pkg = require(`${name}/package.json`) as { version: string };
    if (pkg.version !== version)
      throw new Error(`Unverified ${name} version: ${pkg.version}`);
  }
  return {
    processPixels: (
      require("vectorize-text/lib/vtext.js") as {
        processPixels: (pixels: unknown, options: object, size: number) => Mesh;
      }
    ).processPixels,
    ndarray: require("ndarray") as (
      data: Uint8Array,
      shape: number[],
      stride: number[],
    ) => unknown,
  };
}

/** Each invocation prepares one changed title; mounted figures own reuse. */
export async function prepareAxisText(
  source: string,
  field: string,
  stackglRoot: string,
): Promise<PreparedAxisText> {
  return (await prepareCore(source, field, stackglRoot)).mesh;
}
export async function prepareWithEvidence(
  source: string,
  field: string,
  stackglRoot: string,
): Promise<MeshEvidence> {
  const prepared = await prepareCore(source, field, stackglRoot);
  const { mesh, raster } = prepared;
  return {
    ...prepared,
    coverage: compareCoverage(mesh, raster.alpha, raster.width, raster.height),
  };
}
async function prepareCore(
  source: string,
  field: string,
  stackglRoot: string,
): Promise<Omit<MeshEvidence, "coverage">> {
  const started = performance.now();
  try {
    if (!source.trim() || source.length > LIMITS.source)
      throw new Error("Empty or oversized title");
    preparationCounters.typeset++;
    const label = await typesetPlotLabel(source, field, 12, 180);
    const scale = 256 / 12,
      padding = 8;
    const width = Math.ceil(label.width * scale) + padding * 2,
      height = Math.ceil(label.height * scale) + padding * 2;
    if (width > LIMITS.width || height > LIMITS.height)
      throw new Error(`Raster exceeds ${LIMITS.width}x${LIMITS.height} limit`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g transform="translate(${padding},${padding}) scale(${scale})">${label.svg}</g></svg>`;
    const pixels = new Resvg(svg, { font: { loadSystemFonts: false } }).render()
      .pixels;
    const alpha = Uint8Array.from(
      { length: width * height },
      (_, i) => pixels[4 * i + 3]!,
    );
    const { processPixels, ndarray } = converter(stackglRoot);
    preparationCounters.contour++;
    const raw = processPixels(
      ndarray(alpha, [width, height], [1, width]),
      { triangles: true, textAlign: "center", textBaseline: "middle" },
      256,
    );
    if (!raw.positions.length || !raw.cells.length)
      throw new Error("Contour conversion returned no geometry");
    // Canonical positive winding in the y-down mesh coordinate system.
    for (const c of raw.cells) {
      const a = raw.positions[c[0]]!,
        b = raw.positions[c[1]]!,
        d = raw.positions[c[2]]!;
      if ((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) < 0)
        [c[1], c[2]] = [c[2], c[1]];
    }
    const xs = raw.positions.map((p) => p[0]),
      ys = raw.positions.map((p) => p[1]);
    const data = {
      schemaVersion: 1 as const,
      source,
      recipe: RECIPE,
      ...raw,
      bounds: {
        widthEm: Math.max(...xs) - Math.min(...xs),
        heightEm: Math.max(...ys) - Math.min(...ys),
      },
      accessibleText: label.accessibleText,
    };
    const mesh: PreparedAxisText = { ...data, meshHash: meshDigest(data) };
    validateMesh(mesh, field);
    return {
      mesh,
      raster: { width, height, alpha },
      preparationMs: performance.now() - started,
    };
  } catch (error) {
    throw new Error(
      `${field}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function compareCoverage(
  mesh: Mesh,
  alpha: Uint8Array,
  width: number,
  height: number,
): Coverage {
  // Recover the converter's integer ink-center translation from the source mask.
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (alpha[y * width + x]! >= 128) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  const points = mesh.positions.map(([x, y]) => [
    x * 256 + (minX + maxX) / 2,
    y * 256 + (minY + maxY) / 2,
  ]);
  const paths = mesh.cells
    .map(
      (c) =>
        `M${points[c[0]]!.join(",")}L${points[c[1]]!.join(",")}L${points[c[2]]!.join(",")}Z`,
    )
    .join("");
  const rendered = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="white" d="${paths}"/></svg>`,
  ).render();
  const actualAlpha = rendered.pixels;
  let intersection = 0,
    union = 0;
  const mask = new Uint8Array(width * height),
    actual = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = alpha[i]! >= 128 ? 1 : 0;
    actual[i] = actualAlpha[4 * i + 3]! >= 128 ? 1 : 0;
    if (mask[i] && actual[i]) intersection++;
    if (mask[i] || actual[i]) union++;
  }
  // Flood all reference background; enclosed components are glyph holes.
  const visited = new Uint8Array(mask.length);
  let holes = 0,
    filledHolePixels = 0,
    holeBoundaryDifferences = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || visited[i]) continue;
    const queue = [i];
    visited[i] = 1;
    let edge = false,
      filled = 0;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q]!,
        x = k % width,
        y = Math.floor(k / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        edge = true;
      if (actual[k]) filled++;
      for (const n of [
        x > 0 ? k - 1 : -1,
        x + 1 < width ? k + 1 : -1,
        y > 0 ? k - width : -1,
        y + 1 < height ? k + width : -1,
      ])
        if (n >= 0 && !mask[n] && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
    }
    if (!edge && queue.length >= 16) {
      holes++;
      holeBoundaryDifferences += filled;
      // Boundary approximation is measured by IoU. Check the hole interior
      // separately, excluding its one-pixel antialias/contour boundary.
      for (const k of queue) {
        const x = k % width,
          y = Math.floor(k / width);
        if (!actual[k] || x < 1 || y < 1 || x + 1 >= width || y + 1 >= height)
          continue;
        let interior = true;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (mask[k + dy * width + dx]) interior = false;
        if (interior) filledHolePixels++;
      }
    }
  }
  const image = (kind: "reference" | "diff") => {
    const runs = [];
    for (let y = 0; y < height; y++) {
      let start = -1;
      for (let x = 0; x <= width; x++) {
        const i = y * width + x,
          on =
            x < width &&
            (kind === "reference" ? mask[i] : mask[i] !== actual[i]);
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          runs.push(`M${start},${y}h${x - start}v1h-${x - start}Z`);
          start = -1;
        }
      }
    }
    return new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="${kind === "diff" ? "red" : "white"}" d="${runs.join("")}"/></svg>`,
    )
      .render()
      .asPng();
  };
  return {
    iou: intersection / union,
    holes,
    filledHolePixels,
    holeBoundaryDifferences,
    reference: image("reference"),
    actual: rendered.asPng(),
    diff: image("diff"),
  };
}
export function saveMeshEvidence(e: MeshEvidence, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mesh.json"), JSON.stringify(e.mesh));
  for (const name of ["reference", "actual", "diff"] as const)
    fs.writeFileSync(path.join(dir, `${name}.png`), e.coverage[name]);
  fs.writeFileSync(
    path.join(dir, "metrics.json"),
    JSON.stringify(
      {
        iou: e.coverage.iou,
        holes: e.coverage.holes,
        filledHolePixels: e.coverage.filledHolePixels,
        holeBoundaryDifferences: e.coverage.holeBoundaryDifferences,
        vertices: e.mesh.positions.length,
        triangles: e.mesh.cells.length,
        preparationMs: e.preparationMs,
      },
      null,
      2,
    ),
  );
}
