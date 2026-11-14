import { createHash } from "node:crypto";

export const RECIPE = "mathjax-4.1.3-tex-resvg-256-v1" as const;
export const LIMITS = {
  source: 2048,
  width: 4096,
  height: 2048,
  vertices: 100000,
  triangles: 200000,
  bytes: 8 * 1024 * 1024,
} as const;
export type AxisName = "xaxis" | "yaxis" | "zaxis";
export interface PreparedAxisText {
  schemaVersion: 1;
  source: string;
  recipe: typeof RECIPE;
  meshHash: string;
  positions: Array<[number, number]>;
  cells: Array<[number, number, number]>;
  bounds: { widthEm: number; heightEm: number };
  accessibleText: string;
}
export type PreparedAxisTextMap = Record<
  string,
  Partial<Record<AxisName, PreparedAxisText>>
>;
export const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");
export function meshDigest(
  mesh: Omit<PreparedAxisText, "meshHash"> | PreparedAxisText,
): string {
  return sha256(
    JSON.stringify([
      mesh.schemaVersion,
      mesh.recipe,
      mesh.source,
      mesh.positions,
      mesh.cells,
      mesh.bounds.widthEm,
      mesh.bounds.heightEm,
      mesh.accessibleText,
    ]),
  );
}
export function validateMesh(
  value: unknown,
  field: string,
): asserts value is PreparedAxisText {
  const fail = (message: string): never => {
    throw new Error(`${field}: ${message}`);
  };
  if (!value || typeof value !== "object") fail("Expected a prepared title");
  const m = value as PreparedAxisText;
  if (
    m.schemaVersion !== 1 ||
    m.recipe !== RECIPE ||
    typeof m.source !== "string" ||
    !m.source.trim() ||
    m.source.length > LIMITS.source ||
    typeof m.accessibleText !== "string"
  )
    fail("Invalid title metadata");
  if (
    !m.bounds ||
    ![m.bounds.widthEm, m.bounds.heightEm].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    fail("Invalid bounds");
  if (
    !Array.isArray(m.positions) ||
    !m.positions.length ||
    m.positions.length > LIMITS.vertices ||
    !m.positions.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
    )
  )
    fail("Invalid vertices or vertex limit");
  if (
    !Array.isArray(m.cells) ||
    !m.cells.length ||
    m.cells.length > LIMITS.triangles
  )
    fail("Invalid triangles or triangle limit");
  for (const c of m.cells) {
    if (
      !Array.isArray(c) ||
      c.length !== 3 ||
      !c.every((i) => Number.isInteger(i) && i >= 0 && i < m.positions.length)
    )
      fail("Invalid triangle indices");
    const a = m.positions[c[0]]!,
      b = m.positions[c[1]]!,
      d = m.positions[c[2]]!;
    const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    if (!(area > 0)) fail("Degenerate or incorrectly wound triangle");
  }
  if (Buffer.byteLength(JSON.stringify(m)) > LIMITS.bytes)
    fail("Serialized mesh exceeds limit");
  if (m.meshHash !== meshDigest(m)) fail("Mesh hash mismatch");
}
