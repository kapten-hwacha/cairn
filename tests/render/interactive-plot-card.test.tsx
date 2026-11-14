import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractivePlotCard } from "../../components/artifacts/interactive-plot-card.tsx";
import type { Plot3DResult } from "../../src/core/contracts/plot3d.ts";
test("interactive figure starts with accessible preview, downloads and no WebGL allocation", () => {
  const result: Plot3DResult = {
    format: "interactive",
    title: "Surface",
    html: "<!doctype html>",
    preview: {
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
      width: 900,
      height: 650,
    },
    runtime: {
      checked: true,
      rendererVersion: "4.3.0",
      sceneHash: "scene",
      titleHashes: ["x", "y", "z"],
      width: 900,
      height: 650,
    },
  };
  const html = renderToStaticMarkup(
    <InteractivePlotCard result={result} initialInverted />,
  );
  assert.match(html, /alt="Surface"/);
  assert.match(html, />Interact</);
  assert.match(html, /Download plot as HTML/);
  assert.match(html, /Download plot as PNG/);
  assert.match(html, /aria-checked="true"/);
  assert.doesNotMatch(html, /<iframe/);
});
