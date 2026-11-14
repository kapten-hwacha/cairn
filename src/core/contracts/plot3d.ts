import type { PlotInput } from "./jobs.ts";

export type Plot3DDomain = [number, number];
export interface Plot3DInput {
  kind: "3d";
  title: string;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  xDomain: Plot3DDomain;
  yDomain: Plot3DDomain;
  zDomain: Plot3DDomain;
  series: Array<
    | {
        kind: "surface";
        label: string;
        expression: string;
        xDomain?: Plot3DDomain;
        yDomain?: Plot3DDomain;
        sampleAtX?: number[];
        sampleAtY?: number[];
      }
    | {
        kind: "parametric";
        label: string;
        xExpression: string;
        yExpression: string;
        zExpression: string;
        uDomain: Plot3DDomain;
        sampleAtU?: number[];
      }
    | {
        kind: "scatter";
        label: string;
        points: Array<{ x: number; y: number; z: number }>;
      }
  >;
}
export type PlotToolInput = PlotInput | Plot3DInput;
export const PLOT3D_WIDTH = 900;
export const PLOT3D_HEIGHT = 650;
export const PLOT3D_DEADLINE_MS = 30_000;
export const PLOT3D_HTML_BYTES = 8 * 1024 * 1024;
export const PLOT3D_PNG_BYTES = 4 * 1024 * 1024;
export interface Plot3DProof {
  rendererVersion: string;
  sceneHash: string;
  titleHashes: string[];
  width: 900;
  height: 650;
}
export interface Plot3DVerification extends Plot3DProof {
  ready: true;
  preview: string;
  errors: string[];
}
export interface Plot3DVerificationRequest {
  html: string;
  expected: Plot3DProof;
}
export interface Plot3DResult {
  format: "interactive";
  title: string;
  html: string;
  preview: { mimeType: "image/png"; dataUrl: string; width: 900; height: 650 };
  runtime: Plot3DProof & { checked: true };
  notes?: string;
}
export function isPlot3DInput(input: unknown): input is Plot3DInput {
  return (
    !!input &&
    typeof input === "object" &&
    "kind" in input &&
    input.kind === "3d"
  );
}
export function isPlot3DResult(result: unknown): result is Plot3DResult {
  return (
    !!result &&
    typeof result === "object" &&
    "format" in result &&
    result.format === "interactive"
  );
}
export function assertPlot3DDomain(
  value: unknown,
  field: string,
): asserts value is Plot3DDomain {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(Number.isFinite) ||
    !(value[0] < value[1]) ||
    !Number.isFinite(value[1] - value[0]) ||
    !(value[0] + (value[1] - value[0]) / 256 > value[0])
  )
    throw new Error(
      `${field}: expected a finite increasing domain with distinguishable sampling coordinates`,
    );
}
export function validatePlot3DInput(input: Plot3DInput): void {
  function text(value: unknown, field: string, max: number) {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new Error(
        `${field}: expected nonempty text, at most ${max} characters`,
      );
  }
  text(input.title, "title", 160);
  for (const axis of ["x", "y", "z"] as const) {
    text(input[`${axis}Label`], `${axis}Label`, 2048);
    assertPlot3DDomain(input[`${axis}Domain`], `${axis}Domain`);
  }
  if (
    !Array.isArray(input.series) ||
    input.series.length < 1 ||
    input.series.length > 4
  )
    throw new Error("series: expected 1–4 series");
  let points = 0;
  input.series.forEach((series, index) => {
    const field = `series[${index}]`;
    text(series.label, `${field}.label`, 160);
    function seeds(
      values: number[] | undefined,
      domain: Plot3DDomain,
      name: string,
    ) {
      if (
        values !== undefined &&
        (!Array.isArray(values) ||
          values.length > 16 ||
          values.some(
            (n) => !Number.isFinite(n) || n < domain[0] || n > domain[1],
          ))
      )
        throw new Error(
          `${field}.${name}: expected at most 16 finite coordinates inside its domain`,
        );
    }
    if (series.kind === "surface") {
      text(series.expression, `${field}.expression`, 2048);
      for (const axis of ["x", "y"] as const) {
        const d = series[`${axis}Domain`] ?? input[`${axis}Domain`];
        assertPlot3DDomain(d, `${field}.${axis}Domain`);
        const outer = input[`${axis}Domain`];
        if (d[0] < outer[0] || d[1] > outer[1])
          throw new Error(
            `${field}.${axis}Domain: must be inside the scene domain`,
          );
        seeds(
          series[axis === "x" ? "sampleAtX" : "sampleAtY"],
          d,
          `sampleAt${axis.toUpperCase()}`,
        );
      }
    } else if (series.kind === "parametric") {
      for (const axis of ["x", "y", "z"] as const)
        text(series[`${axis}Expression`], `${field}.${axis}Expression`, 2048);
      assertPlot3DDomain(series.uDomain, `${field}.uDomain`);
      seeds(series.sampleAtU, series.uDomain, "sampleAtU");
    } else if (series.kind === "scatter") {
      if (!Array.isArray(series.points) || !series.points.length)
        throw new Error(
          `${field}.points: expected finite supplied data points`,
        );
      points += series.points.length;
      if (points > 10000)
        throw new Error("series: at most 10,000 scatter points in total");
      series.points.forEach((p, i) => {
        if (!p || ![p.x, p.y, p.z].every(Number.isFinite))
          throw new Error(`${field}.points[${i}]: expected finite x, y and z`);
      });
    } else throw new Error(`${field}.kind: unsupported series kind`);
  });
}
export function validatePlot3DPng(dataUrl: unknown): asserts dataUrl is string {
  if (
    typeof dataUrl !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
  )
    throw new Error("3D preview: expected a PNG data URL");
  const encoded = dataUrl.slice(22);
  if (encoded.length > Math.ceil(PLOT3D_PNG_BYTES / 3) * 4)
    throw new Error("3D preview exceeds 4 MiB");
  const header = atob(encoded.slice(0, 44));
  const bytes = Uint8Array.from(header, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR" ||
    view.getUint32(16) !== PLOT3D_WIDTH ||
    view.getUint32(20) !== PLOT3D_HEIGHT
  )
    throw new Error("3D preview: invalid PNG signature or dimensions");
}
export function validatePlot3DVerification(
  value: unknown,
  expected: Plot3DProof,
): asserts value is Plot3DVerification {
  if (!value || typeof value !== "object")
    throw new Error("3D verification: missing result");
  const result = value as Partial<Plot3DVerification>;
  if (
    result.ready !== true ||
    result.width !== expected.width ||
    result.height !== expected.height ||
    result.rendererVersion !== expected.rendererVersion ||
    result.sceneHash !== expected.sceneHash ||
    !Array.isArray(result.titleHashes) ||
    JSON.stringify(result.titleHashes) !==
      JSON.stringify(expected.titleHashes) ||
    !Array.isArray(result.errors) ||
    result.errors.length
  )
    throw new Error(
      `3D verification failed: ${(result.errors ?? ["readiness or provenance mismatch"]).join("; ")}`,
    );
  validatePlot3DPng(result.preview);
}
