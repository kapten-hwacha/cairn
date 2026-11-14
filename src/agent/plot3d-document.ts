import type { Plot3DProof } from "../core/contracts/plot3d.ts";
import { PLOT3D_HTML_BYTES } from "../core/contracts/plot3d.ts";
import { PLOT3D_RUNTIME, PLOT3D_LIBRARY_SCRIPT } from "./plot3d-scripts.ts";
import notices from "../vendor/plotly-native-math/licenses.json";
export interface Plot3DDocumentData {
  traces: unknown[];
  layout: Record<string, unknown>;
  config: Record<string, unknown>;
  proof: Plot3DProof;
}
export function buildPlot3DDocument(data: Plot3DDocumentData): string {
  const json = JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;font-src data:;connect-src 'none'"><title>Interactive 3D plot</title><style>html,body,#plot{margin:0;width:100%;height:100%;overflow:hidden;background:white}#plot{min-width:1px;min-height:1px}</style></head><body><div id="plot" role="img" aria-label="Interactive three-dimensional plot"></div><script id="plot-data" type="application/json">${json}</script><script>${PLOT3D_LIBRARY_SCRIPT}</script><script>${PLOT3D_RUNTIME}</script></body></html>`;
  const licensed = html.replace(
    "</body>",
    () =>
      `<script type="application/json" id="plot3d-notices">${JSON.stringify(notices).replaceAll("<", "\\u003c")}</script></body>`,
  );
  if (new TextEncoder().encode(licensed).length > PLOT3D_HTML_BYTES)
    throw new Error("Interactive plot exceeds 8 MiB HTML limit");
  return licensed;
}
