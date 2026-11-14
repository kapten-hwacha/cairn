import { contour } from "../vendor/plotly-native-math/contour.mjs";
import { typesetPlotLabel } from "./plot-labels.ts";
import { getHeadless } from "./subagents/headless.ts";
export const PLOT3D_RECIPE = "mathjax-4.1.3-tex-resvg-256-v1" as const;
export interface PreparedAxisText {
  schemaVersion: 1;
  source: string;
  recipe: typeof PLOT3D_RECIPE;
  meshHash: string;
  positions: Array<[number, number]>;
  cells: Array<[number, number, number]>;
  bounds: { widthEm: number; heightEm: number };
  accessibleText: string;
}
export async function plot3DHash(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export function meshPayload(
  m: Omit<PreparedAxisText, "meshHash"> | PreparedAxisText,
): string {
  return JSON.stringify([
    m.schemaVersion,
    m.recipe,
    m.source,
    m.positions,
    m.cells,
    m.bounds.widthEm,
    m.bounds.heightEm,
    m.accessibleText,
  ]);
}
export async function validatePreparedAxisText(
  m: PreparedAxisText,
  field: string,
): Promise<void> {
  const fail = (why: string): never => {
    throw new Error(`${field}: ${why}`);
  };
  if (
    m.schemaVersion !== 1 ||
    m.recipe !== PLOT3D_RECIPE ||
    !m.source.trim() ||
    m.source.length > 2048 ||
    typeof m.accessibleText !== "string"
  )
    fail("Invalid title metadata");
  if (
    !m.positions.length ||
    m.positions.length > 100000 ||
    !m.positions.every((p) => p.length === 2 && p.every(Number.isFinite))
  )
    fail("Invalid title vertices");
  if (!m.cells.length || m.cells.length > 200000)
    fail("Invalid title triangle count");
  for (const c of m.cells) {
    if (
      c.length !== 3 ||
      !c.every((i) => Number.isInteger(i) && i >= 0 && i < m.positions.length)
    )
      fail("Invalid title triangle indices");
    const a = m.positions[c[0]]!,
      b = m.positions[c[1]]!,
      d = m.positions[c[2]]!;
    if (!((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) > 0))
      fail("Invalid title winding");
  }
  const xs = m.positions.map((p) => p[0]),
    ys = m.positions.map((p) => p[1]);
  const extent = (values: number[]) =>
    values.reduce(
      (r, v) => [Math.min(r[0]!, v), Math.max(r[1]!, v)],
      [Infinity, -Infinity],
    );
  const xb = extent(xs),
    yb = extent(ys);
  if (
    m.bounds.widthEm !== xb[1]! - xb[0]! ||
    m.bounds.heightEm !== yb[1]! - yb[0]! ||
    !(m.bounds.widthEm > 0 && m.bounds.heightEm > 0)
  )
    fail("Invalid title bounds");
  if (new TextEncoder().encode(JSON.stringify(m)).length > 8 * 1024 * 1024)
    fail("Oversized title mesh");
  if (m.meshHash !== (await plot3DHash(meshPayload(m))))
    fail("Title mesh hash mismatch");
}
export function checkMeshCoverage(
  reference: Uint8Array,
  actual: Uint8Array,
  width: number,
  height: number,
) {
  let intersection = 0,
    union = 0;
  const mask = Uint8Array.from(reference, (v) => (v >= 128 ? 1 : 0));
  const filled = Uint8Array.from({ length: width * height }, (_, i) =>
    actual[4 * i + 3]! >= 128 ? 1 : 0,
  );
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && filled[i]) intersection++;
    if (mask[i] || filled[i]) union++;
  }
  const seen = new Uint8Array(mask.length);
  let holes = 0,
    filledHolePixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || seen[i]) continue;
    const queue = [i];
    seen[i] = 1;
    let edge = false;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q]!,
        x = k % width,
        y = Math.floor(k / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        edge = true;
      for (const n of [
        x > 0 ? k - 1 : -1,
        x + 1 < width ? k + 1 : -1,
        y > 0 ? k - width : -1,
        y + 1 < height ? k + width : -1,
      ])
        if (n >= 0 && !mask[n] && !seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
    }
    if (!edge && queue.length >= 16) {
      holes++;
      for (const k of queue) {
        if (!filled[k]) continue;
        let interior = true;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (mask[k + dy * width + dx]) interior = false;
        if (interior) filledHolePixels++;
      }
    }
  }
  const iou = intersection / union;
  if (!(iou >= 0.98) || filledHolePixels)
    throw new Error(
      `Title contour coverage failed (IoU ${iou}, filled hole pixels ${filledHolePixels})`,
    );
  return { iou, holes, filledHolePixels };
}
export async function preparePlot3DAxisText(
  source: string,
  field: string,
): Promise<PreparedAxisText> {
  const rasterize = getHeadless().rasterizeSvgPixels;
  if (!rasterize)
    throw new Error(`${field}: transparent rasterizer unavailable`);
  try {
    const label = await typesetPlotLabel(source, field, 12, 180),
      scale = 256 / 12,
      padding = 8;
    const width = Math.ceil(label.width * scale) + padding * 2,
      height = Math.ceil(label.height * scale) + padding * 2;
    if (width > 4096 || height > 2048)
      throw new Error("Title raster exceeds 4096x2048 limit");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g transform="translate(${padding},${padding}) scale(${scale})">${label.svg}</g></svg>`;
    const pixels = await rasterize(svg, { width, height });
    if (
      pixels.width !== width ||
      pixels.height !== height ||
      pixels.rgba.length !== width * height * 4
    )
      throw new Error("Raster size mismatch");
    const alpha = Uint8Array.from(
      { length: width * height },
      (_, i) => pixels.rgba[i * 4 + 3]!,
    );
    const {
      positions: rawPositions,
      cells: rawCells,
      originPixels,
    } = contour(alpha, width, height);
    const raw = { positions: rawPositions, cells: rawCells };
    for (const c of raw.cells) {
      const a = raw.positions[c[0]]!,
        b = raw.positions[c[1]]!,
        d = raw.positions[c[2]]!;
      if ((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) < 0)
        [c[1], c[2]] = [c[2], c[1]];
    }
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of raw.positions) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const data = {
      schemaVersion: 1 as const,
      source,
      recipe: PLOT3D_RECIPE,
      ...raw,
      bounds: { widthEm: maxX - minX, heightEm: maxY - minY },
      accessibleText: label.accessibleText,
    };
    const mesh = { ...data, meshHash: await plot3DHash(meshPayload(data)) };
    await validatePreparedAxisText(mesh, field);
    const positions = mesh.positions.map(([x, y]) => [
      x * 256 + originPixels[0] + 0.5,
      y * 256 + originPixels[1] + 0.5,
    ]);
    const d = mesh.cells
      .map(
        (c) =>
          `M${positions[c[0]]!.join(",")}L${positions[c[1]]!.join(",")}L${positions[c[2]]!.join(",")}Z`,
      )
      .join("");
    const reconstructed = await rasterize(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="white" d="${d}"/></svg>`,
      { width, height },
    );
    checkMeshCoverage(alpha, reconstructed.rgba, width, height);
    return mesh;
  } catch (error) {
    throw new Error(
      `${field}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
