import {
  validatePlot3DInput,
  validatePlot3DVerification,
  type Plot3DInput,
  type Plot3DResult,
  type Plot3DProof,
} from "../core/contracts/plot3d.ts";
import { compileScopedPlotExpression } from "./plot-expression.ts";
import {
  sampleAnalyticSurface,
  sampleParametricCurve,
  type Vector3,
} from "./plot3d-sampling.ts";
import { preparePlot3DAxisText, plot3DHash } from "./plot3d-labels.ts";
import { buildPlot3DDocument } from "./plot3d-document.ts";
import { typesetPlotLabel } from "./plot-labels.ts";
import { getHeadless } from "./subagents/headless.ts";
const palette = ["#2563eb", "#e05a33", "#20936b", "#9b59b6"];
export async function renderPlot3D(
  input: Plot3DInput,
  options: { signal?: AbortSignal } = {},
): Promise<Plot3DResult> {
  options.signal?.throwIfAborted();
  validatePlot3DInput(input);
  const traces: Record<string, unknown>[] = [];
  let evaluations = 0,
    vertices = 0;
  for (const [index, series] of input.series.entries()) {
    options.signal?.throwIfAborted();
    try {
      const color = palette[index],
        common = {
          name: series.label,
          showlegend: false,
          hoverinfo: "x+y+z",
          connectgaps: false,
        };
      if (series.kind === "scatter") {
        vertices += series.points.length;
        traces.push({
          ...common,
          type: "scatter3d",
          mode: "markers",
          x: series.points.map((p) => p.x),
          y: series.points.map((p) => p.y),
          z: series.points.map((p) => p.z),
          marker: { color, size: 4 },
        });
      } else if (series.kind === "parametric") {
        const expressions = [
          series.xExpression,
          series.yExpression,
          series.zExpression,
        ].map((s) => compileScopedPlotExpression(s, ["u"]));
        const sampled = sampleParametricCurve(
          (u) => expressions.map((e) => e.evaluate({ u })) as Vector3,
          {
            uDomain: series.uDomain,
            axisDomains: [input.xDomain, input.yDomain, input.zDomain],
            seedU: series.sampleAtU,
            asts: expressions.map((e) => e.ast),
          },
        );
        evaluations += sampled.evaluations;
        vertices += sampled.segments.reduce((n, s) => n + s.length, 0);
        const coordinates = sampled.segments.flatMap((s) => [...s, null]);
        traces.push({
          ...common,
          type: "scatter3d",
          mode: "lines",
          x: coordinates.map((p) => p?.x ?? null),
          y: coordinates.map((p) => p?.y ?? null),
          z: coordinates.map((p) => p?.z ?? null),
          line: { color, width: 5 },
        });
      } else {
        const expression = compileScopedPlotExpression(series.expression, [
          "x",
          "y",
        ]);
        const sampled = sampleAnalyticSurface(
          (x, y) => expression.evaluate({ x, y }),
          {
            xDomain: series.xDomain ?? input.xDomain,
            yDomain: series.yDomain ?? input.yDomain,
            zDomain: input.zDomain,
            seedX: series.sampleAtX,
            seedY: series.sampleAtY,
            ast: expression.ast,
          },
        );
        evaluations += sampled.evaluations;
        vertices += sampled.x.length * sampled.y.length;
        traces.push({
          ...common,
          type: "surface",
          x: sampled.x,
          y: sampled.y,
          z: sampled.z,
          showscale: false,
          colorscale: [
            [0, color],
            [1, color],
          ],
          opacity: 0.9,
        });
      }
      if (evaluations > 300000 || vertices > 70000)
        throw new Error("Combined analytic/vertex budget exceeded");
    } catch (error) {
      throw new Error(
        `series[${index}]: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  const labels = await Promise.all(
    [input.xLabel, input.yLabel, input.zLabel].map((label, i) =>
      preparePlot3DAxisText(label, `${["x", "y", "z"][i]}Label`),
    ),
  );
  options.signal?.throwIfAborted();
  const proof: Plot3DProof = {
    rendererVersion: "4.3.0",
    sceneHash: await plot3DHash(JSON.stringify(input)),
    titleHashes: labels.map((l) => l.meshHash),
    width: 900,
    height: 650,
  };
  const axis = (label: string, range: [number, number], color: string) => ({
    title: { text: label, font: { size: 20, color } },
    range,
    autorange: false,
    type: "linear",
    showbackground: true,
    backgroundcolor: "#f8fafc",
    gridcolor: "#cbd5e1",
    zerolinecolor: "#94a3b8",
    tickfont: { size: 11, color: "#334155" },
  });
  const captions = await Promise.all(
    [input.title, ...input.series.map((s) => s.label)].map((source, i) =>
      typesetPlotLabel(
        source,
        i === 0 ? "title" : `series[${i - 1}].label`,
        i === 0 ? 18 : 13,
        720,
      ),
    ),
  );
  const topMargin = Math.max(85, captions[0]!.height + 25);
  const bottomMargin =
    35 +
    captions.slice(1).reduce((height, label) => height + label.height + 8, 0);
  const plotHeight = 650 - topMargin - bottomMargin;
  if (plotHeight < 250)
    throw new Error(
      "Title and series labels leave too little space for the 3D scene; shorten them",
    );
  let legendOffset = 15;
  const images = captions.map((label, i) => {
    const swatch = i === 0 ? 0 : 18;
    const width = Math.ceil(label.width) + swatch,
      height = Math.ceil(label.height);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${i === 0 ? "" : `<rect x="0" y="${Math.max(0, (height - 8) / 2)}" width="10" height="8" fill="${palette[i - 1]}"/>`}<g transform="translate(${swatch},0)">${label.svg}</g></svg>`;
    const encoded = Array.from(new TextEncoder().encode(svg), (b) =>
      String.fromCharCode(b),
    ).join("");
    const y =
      i === 0 ? 1 + (topMargin - 8) / plotHeight : -legendOffset / plotHeight;
    if (i > 0) legendOffset += height + 8;
    return {
      source: `data:image/svg+xml;base64,${btoa(encoded)}`,
      xref: "paper",
      yref: "paper",
      x: i === 0 ? 0.5 : 0,
      y,
      sizex: width / 820,
      sizey: height / plotHeight,
      xanchor: i === 0 ? "center" : "left",
      yanchor: "top",
      sizing: "contain",
      layer: "above",
    };
  });
  const layout = {
    autosize: true,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    margin: { l: 40, r: 40, t: topMargin, b: bottomMargin },
    images,
    scene: {
      xaxis: axis(input.xLabel, input.xDomain, "#c43042"),
      yaxis: axis(input.yLabel, input.yDomain, "#148348"),
      zaxis: axis(input.zLabel, input.zDomain, "#315ab8"),
      aspectmode: "cube",
      camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
      dragmode: "orbit",
    },
    showlegend: false,
  };
  const config = {
    displayModeBar: false,
    scrollZoom: false,
    responsive: false,
    plotGlPixelRatio: 1,
    preparedAxisText: {
      scene: { xaxis: labels[0], yaxis: labels[1], zaxis: labels[2] },
    },
  };
  const html = buildPlot3DDocument({ traces, layout, config, proof });
  const verify = getHeadless().verifyPlot3D;
  if (!verify) throw new Error("3D runtime verification unavailable");
  const result = await verify({ html, expected: proof }, options);
  validatePlot3DVerification(result, proof);
  return {
    format: "interactive",
    title: input.title,
    html,
    preview: {
      mimeType: "image/png",
      dataUrl: result.preview,
      width: 900,
      height: 650,
    },
    runtime: { ...proof, checked: true },
    notes: `Deterministic 3D plot; ${vertices} vertices, ${evaluations} analytic evaluations. Fixed domains; observed sampling tolerance 0.001 of axis spans.`,
  };
}
