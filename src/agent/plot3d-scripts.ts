import plotlySource from "../vendor/plotly-native-math/plotly-source.json";
import { PLOT3D_RUNTIME } from "./plot3d-runtime.ts";
/** Exact inline bytes are also emitted as assets, so Tauri authorizes their hashes. */
export const PLOT3D_LIBRARY_SCRIPT =
  'parent.postMessage({type:"lh:plot3d-stage",stage:"scripts-started"},"*");' +
  plotlySource.replace(/<\/script/gi, "<\\/script");
export { PLOT3D_RUNTIME };
