import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import { build } from "vite";
import puppeteer from "puppeteer-core";
import { Resvg } from "@resvg/resvg-js";
import { renderPlot } from "../src/agent/plot.ts";
import type { PlotInput } from "../src/core/contracts/jobs.ts";

test(
	"bundled renderer runs offline in a real browser worker and exports font-independent SVG",
	{ timeout: 60_000 },
	async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plot-worker-"));
		const entry = path.join(dir, "entry.ts"),
			out = path.join(dir, "out");
		fs.writeFileSync(
			entry,
			`export { renderPlot } from ${JSON.stringify(path.resolve("src/agent/plot.ts"))};`,
		);
		let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
		const server = createServer((_request, response) => {
			response.setHeader("content-type", "text/html");
			response.end(
				'<!doctype html><title>Offline worker test</title><link rel="icon" href="data:,">',
			);
		});
		try {
			await build({
				configFile: false,
				publicDir: false,
				logLevel: "error",
				build: {
					target: "esnext",
					outDir: out,
					lib: { entry, formats: ["es"], fileName: () => "worker.js" },
					rollupOptions: { output: { inlineDynamicImports: true } },
				},
			});
			const source = fs.readFileSync(path.join(out, "worker.js"), "utf8");
			console.log(
				`Plot renderer worker bundle: ${Buffer.byteLength(source)} bytes`,
			);
			const numericEntry = path.join(dir, "numeric.ts");
			fs.writeFileSync(
				numericEntry,
				`import {parse,View} from 'vega'; import {compile} from 'vega-lite'; import {expressionInterpreter} from 'vega-interpreter'; export async function render(spec) {const view=new View(parse(compile(spec).spec,undefined,{ast:true}),{renderer:'none',expr:expressionInterpreter});try{return await view.toSVG();}finally{view.finalize();}}`,
			);
			await build({
				configFile: false,
				publicDir: false,
				root: process.cwd(),
				resolve: { dedupe: ["vega", "vega-lite", "vega-interpreter"] },
				logLevel: "error",
				build: {
					target: "esnext",
					outDir: path.join(dir, "numeric"),
					lib: {
						entry: numericEntry,
						formats: ["es"],
						fileName: () => "worker.js",
					},
					rollupOptions: { output: { inlineDynamicImports: true } },
				},
			});
			const numericSize = fs.statSync(path.join(dir, "numeric/worker.js")).size;
			console.log(
				`Vega-only comparison bundle: ${numericSize} bytes; math/layout increment: ${Buffer.byteLength(source) - numericSize} bytes (unminified isolated bundles)`,
			);
			browser = await puppeteer.launch({
				executablePath:
					process.env.CHROME_PATH ??
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				headless: true,
				pipe: true,
				userDataDir: path.join(dir, "chrome"),
			});
			const page = await browser.newPage();
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			assert.ok(address && typeof address !== "string");
			await page.goto(`http://127.0.0.1:${address.port}/`);
			const network: string[] = [];
			await page.setRequestInterception(true);
			page.on("request", (request) => {
				network.push(request.url());
				if (request.url().startsWith("blob:")) void request.continue();
				else void request.abort();
			});
			page.on("console", (message) =>
				console.log(`Worker browser: ${message.text()}`),
			);
			const cases = JSON.parse(
				fs.readFileSync("tests/fixtures/plot-layout/cases.json", "utf8"),
			).cases as { id: string; input: PlotInput }[];
			const samplingCases = JSON.parse(
				fs.readFileSync("tests/fixtures/plot-sampling/cases.json", "utf8"),
			).cases as { id: string; input: PlotInput }[];
			const annotationCases = JSON.parse(
				fs.readFileSync("tests/fixtures/plot-annotations/cases.json", "utf8"),
			).cases as { id: string; input: PlotInput }[];
			for (const input of [
				cases.find((c) => c.id === "07-bode")!.input,
				samplingCases.find((c) => c.id === "09-analytic-branches")!.input,
				samplingCases.find((c) => c.id === "10-independent-panels")!.input,
				...annotationCases.map((c) => c.input),
			]) {
				const result = await page.evaluate(
					async (workerSource, input) => {
						const url = URL.createObjectURL(
							new Blob([workerSource], { type: "text/javascript" }),
						);
						const bootstrap = URL.createObjectURL(
							new Blob(
								[
									`try { const {renderPlot} = await import(${JSON.stringify(url)}); self.onmessage = async ({data}) => { try { self.postMessage({svg: await renderPlot(data)}); } catch(e) { self.postMessage({error:e.stack || String(e)}); } }; self.postMessage({ready:true}); } catch(e) { self.postMessage({error:e.stack || String(e)}); }`,
								],
								{ type: "text/javascript" },
							),
						);
						const worker = new Worker(bootstrap, { type: "module" });
						try {
							const svg = await new Promise<string>((resolve, reject) => {
								worker.onerror = (e) =>
									reject(
										new Error(
											`Worker startup: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`,
										),
									);
								worker.onmessage = (e) => {
									if (e.data.ready) worker.postMessage(input);
									else if (e.data.error) reject(new Error(e.data.error));
									else resolve(e.data.svg);
								};
							});
							const parsed = new DOMParser().parseFromString(
								svg,
								"image/svg+xml",
							);
							const parseError = parsed.querySelector("parsererror");
							if (parseError)
								throw new Error(`Invalid SVG: ${parseError.textContent}`);
							const blob = new Blob([svg], { type: "image/svg+xml" });
							const imageUrl = URL.createObjectURL(blob);
							const image = new Image();
							image.src = imageUrl;
							await image.decode();
							const canvas = new OffscreenCanvas(
								image.naturalWidth,
								image.naturalHeight,
							);
							canvas.getContext("2d")!.drawImage(image, 0, 0);
							const png = await canvas.convertToBlob({ type: "image/png" });
							URL.revokeObjectURL(imageUrl);
							return { svg, pngBytes: png.size };
						} finally {
							worker.terminate();
							URL.revokeObjectURL(url);
							URL.revokeObjectURL(bootstrap);
						}
					},
					source,
					input,
				);
				assert.ok(result.pngBytes > 1000);
				assert.doesNotMatch(
					result.svg,
					/<(?:text|foreignObject|image)\b|href=/,
				);
				assert.equal(
					(result.svg.match(/data-plot-panel=/g) ?? []).length,
					input.panels.length,
				);
				assert.deepEqual(
					network.filter((url) => !url.startsWith("blob:")),
					[],
				);
				const nodeSvg = await renderPlot(input);
				assert.ok(
					new Resvg(result.svg, { font: { loadSystemFonts: false } })
						.render()
						.asPng().length > 1000,
				);
				// Tick font metrics may change numeric margins across runtimes; data paths
				// and the embedded label glyphs must be identical.
				const paths = (svg: string) =>
					[...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
				assert.deepEqual(paths(result.svg), paths(nodeSvg));
			}
		} finally {
			await browser?.close();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			fs.rmSync(dir, { recursive: true, force: true });
		}
	},
);
