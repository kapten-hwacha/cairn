import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { buildDemoVerifySrcDoc, createWorkerHeadless } from "../../src/worker/headless-worker.ts";
import { loadPhotonWasm, PhotonImage, SamplingFilter, resize } from "../../src/worker/shims/photon-wasm.ts";
import { ShimBuffer } from "../../src/worker/shims/crypto.ts";
import { processImage } from "../../src/agent/image-processing/index.ts";

const PDF_FIXTURE = path.resolve("tests/fixtures/sample-3page.pdf");

describe("src/worker/headless-worker.ts & photon-wasm.ts", () => {
	it("renders and prepares an SVG without a global Buffer", async () => {
		const original = globalThis.Buffer;
		try {
			// Initialize WASM before hiding Node's global, which its loader may use.
			const headless = createWorkerHeadless();
			const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60"/></svg>';
			await headless.renderSvg(svg);
			(globalThis as { Buffer?: typeof Buffer }).Buffer = undefined;
			const png = await headless.renderSvg(svg);
			const image = await processImage(png, "image/png", { autoResizeImages: false });
			assert.equal(image.ok, true);
		} finally {
			globalThis.Buffer = original;
		}
	});

	it("supports PNG chunk operations and isBuffer/allocUnsafe in the worker Buffer shim", () => {
		const chunk = ShimBuffer.alloc(8);
		assert.equal(ShimBuffer.isBuffer(chunk), true);
		assert.equal(ShimBuffer.isBuffer(new Uint8Array(4)), false);
		assert.equal(ShimBuffer.allocUnsafe(4).length, 4);
		chunk.writeUInt32BE(0x12345678, 0);
		chunk.write("IDAT", 4, "ascii");
		const copy = ShimBuffer.alloc(8);
		chunk.copy(copy);
		assert.equal(copy.toString("hex"), "1234567849444154");
	});

	it("falls back to renderSvgViaHost when Resvg fails", async () => {
		const fakePng = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
		let captured: { svg: string; width: number; height: number } | null = null;
		const headless = createWorkerHeadless({
			async renderSvgViaHost(svg, width, height) {
				captured = { svg, width, height };
				return new Uint8Array(fakePng);
			},
		});
		const out = await headless.renderSvg("<svg width=\"320\" height=\"180\"><not-valid-xml", {
			width: 320,
			height: 180,
		});
		assert.deepEqual(captured, {
			svg: "<svg width=\"320\" height=\"180\"><not-valid-xml",
			width: 320,
			height: 180,
		});
		assert.equal(out.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	});
	it("rasterizes SVG via @resvg/resvg-wasm into a canonical single-IDAT PNG", async () => {
		const headless = createWorkerHeadless();
		const png = await headless.renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#2563eb"/></svg>');
		assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
		assert.equal(png.readUInt32BE(16), 120);
		assert.equal(png.readUInt32BE(20), 60);
	});

	it("renders PDF pages through the pluggable 2D canvas factory and canonicalizes PNG output", async () => {
		const headless = createWorkerHeadless({
			createCanvas2D(width, height) {
				const c = createCanvas(width, height);
				return {
					canvas: c,
					context: c.getContext("2d"),
					async toPng() {
						return new Uint8Array(c.toBuffer("image/png"));
					},
				};
			},
		});
		const pages = await headless.renderPdfPages(PDF_FIXTURE, [1], { dpi: 72 });
		assert.equal(pages.length, 1);
		assert.equal(pages[0]!.page, 1);
		assert.equal(pages[0]!.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	});

	it("injects the demo verification script into srcdoc and loads Photon WASM via WebAssembly.instantiate", async () => {
		const srcDoc = buildDemoVerifySrcDoc("<!doctype html><html><body><h1>Demo</h1></body></html>", "req-1", 500, "1 + 1");
		assert.match(srcDoc, /lh:demo-probe-done/);
		assert.match(srcDoc, /req-1/);
		assert.match(srcDoc, /30000/);

		const photon = await loadPhotonWasm();
		assert.equal(typeof photon.PhotonImage.new_from_byteslice, "function");
		assert.equal(typeof PhotonImage.new_from_byteslice, "function");
		assert.equal(typeof resize, "function");
		assert.equal(typeof SamplingFilter.Lanczos3, "number");
	});

	it("preserves literal $& and $' sequences in probe and clamps non-finite/negative settleMs in buildDemoVerifySrcDoc", () => {
		const trickyProbe = 'window.__result = "$&" + "$\'" + "$`" + "$$";';
		const srcDoc = buildDemoVerifySrcDoc("<!doctype html><html><head></head><body></body></html>", "req-test", -500, trickyProbe);

		assert.ok(srcDoc.includes(JSON.stringify(trickyProbe)), "Expected literal probe string to be preserved without regex replacement corruption");
		assert.match(srcDoc, /var settleMs = 0;/);

		const clampedDoc = buildDemoVerifySrcDoc("<!doctype html><html><body></body></html>", "req-test-2", 45000);
		assert.match(clampedDoc, /var settleMs = 30000;/);

		const nanDoc = buildDemoVerifySrcDoc("<!doctype html><html><body></body></html>", "req-test-3", Number.NaN);
		assert.match(nanDoc, /var settleMs = 3000;/);

		const infDoc = buildDemoVerifySrcDoc("<!doctype html><html><body></body></html>", "req-test-4", Infinity);
		assert.match(infDoc, /var settleMs = 3000;/);
	});
});
