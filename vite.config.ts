import path from "node:path";
import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { lhViteDevBridgePlugin } from "./src/worker/vite-dev-bridge.ts";
import {
	PLOT3D_LIBRARY_SCRIPT,
	PLOT3D_RUNTIME,
} from "./src/agent/plot3d-scripts.ts";

export default defineConfig(({ mode }) => ({
	base: "./",
	server: {
		host: process.env.TAURI_DEV_HOST || "0.0.0.0",
		port: 5173,
	},
	define: {
		"process.env.NODE_ENV": JSON.stringify(
			process.env.NODE_ENV || "production",
		),
		global: "globalThis",
	},
	plugins: [
		react(),
		lhViteDevBridgePlugin(),
		{
			name: "plot3d-trusted-script-hashes",
			generateBundle() {
				this.emitFile({
					type: "asset",
					fileName: "assets/plot3d-LICENSES.txt",
					source: fs.readFileSync(
						path.resolve(
							__dirname,
							"src/vendor/plotly-native-math/LICENSES.txt",
						),
						"utf8",
					),
				});
				this.emitFile({
					type: "asset",
					fileName: "assets/plot3d-library.js",
					source: PLOT3D_LIBRARY_SCRIPT,
				});
				this.emitFile({
					type: "asset",
					fileName: "assets/plot3d-runtime.js",
					source: PLOT3D_RUNTIME,
				});
				if (mode === "plot3d-smoke")
					this.emitFile({
						type: "asset",
						fileName: "assets/plot3d-webgl-failure.js",
						source:
							"HTMLCanvasElement.prototype.getContext=function(){return null;}",
					});
			},
		},
	],
	resolve: {
		alias: [
			{
				find: /^node:buffer$/,
				replacement: path.resolve(__dirname, "src/worker/shims/buffer.ts"),
			},
			{
				find: /^buffer$/,
				replacement: path.resolve(__dirname, "src/worker/shims/buffer.ts"),
			},
			{ find: "@", replacement: path.resolve(__dirname, "./") },
			{
				find: "next/navigation",
				replacement: path.resolve(__dirname, "src/client/router.tsx"),
			},
			{
				find: "next/link",
				replacement: path.resolve(__dirname, "src/client/router.tsx"),
			},
			{
				find: /^node:path$/,
				replacement: path.resolve(__dirname, "src/worker/shims/path.ts"),
			},
			{
				find: /^path$/,
				replacement: path.resolve(__dirname, "src/worker/shims/path.ts"),
			},
			{
				find: /^node:fs\/promises$/,
				replacement: path.resolve(__dirname, "src/worker/shims/fs-promises.ts"),
			},
			{
				find: /^fs\/promises$/,
				replacement: path.resolve(__dirname, "src/worker/shims/fs-promises.ts"),
			},
			{
				find: /^node:fs$/,
				replacement: path.resolve(__dirname, "src/worker/shims/fs.ts"),
			},
			{
				find: /^fs$/,
				replacement: path.resolve(__dirname, "src/worker/shims/fs.ts"),
			},
			{
				find: /^node:crypto$/,
				replacement: path.resolve(__dirname, "src/worker/shims/crypto.ts"),
			},
			{
				find: /^crypto$/,
				replacement: path.resolve(__dirname, "src/worker/shims/crypto.ts"),
			},
			{
				find: /^node:async_hooks$/,
				replacement: path.resolve(__dirname, "src/worker/shims/async_hooks.ts"),
			},
			{
				find: /^async_hooks$/,
				replacement: path.resolve(__dirname, "src/worker/shims/async_hooks.ts"),
			},
			{
				find: /^node:os$/,
				replacement: path.resolve(__dirname, "src/worker/shims/os.ts"),
			},
			{
				find: /^os$/,
				replacement: path.resolve(__dirname, "src/worker/shims/os.ts"),
			},
			{
				find: /^node:url$/,
				replacement: path.resolve(__dirname, "src/worker/shims/url.ts"),
			},
			{
				find: /^url$/,
				replacement: path.resolve(__dirname, "src/worker/shims/url.ts"),
			},
			{
				find: /^node:util$/,
				replacement: path.resolve(__dirname, "src/worker/shims/util.ts"),
			},
			{
				find: /^util$/,
				replacement: path.resolve(__dirname, "src/worker/shims/util.ts"),
			},
			{
				find: /^node:module$/,
				replacement: path.resolve(__dirname, "src/worker/shims/module.ts"),
			},
			{
				find: /^module$/,
				replacement: path.resolve(__dirname, "src/worker/shims/module.ts"),
			},
			{
				find: /^node:worker_threads$/,
				replacement: path.resolve(
					__dirname,
					"src/worker/shims/worker_threads.ts",
				),
			},
			{
				find: /^worker_threads$/,
				replacement: path.resolve(
					__dirname,
					"src/worker/shims/worker_threads.ts",
				),
			},
			{
				find: /^node:child_process$/,
				replacement: path.resolve(
					__dirname,
					"src/worker/shims/child_process.ts",
				),
			},
			{
				find: /^child_process$/,
				replacement: path.resolve(
					__dirname,
					"src/worker/shims/child_process.ts",
				),
			},
			{
				find: /^node:http$/,
				replacement: path.resolve(__dirname, "src/worker/shims/http.ts"),
			},
			{
				find: /^http$/,
				replacement: path.resolve(__dirname, "src/worker/shims/http.ts"),
			},
			{
				find: /^node:https$/,
				replacement: path.resolve(__dirname, "src/worker/shims/https.ts"),
			},
			{
				find: /^https$/,
				replacement: path.resolve(__dirname, "src/worker/shims/https.ts"),
			},
			{
				find: /^node:http2$/,
				replacement: path.resolve(__dirname, "src/worker/shims/http2.ts"),
			},
			{
				find: /^http2$/,
				replacement: path.resolve(__dirname, "src/worker/shims/http2.ts"),
			},
			{
				find: /^node:tls$/,
				replacement: path.resolve(__dirname, "src/worker/shims/tls.ts"),
			},
			{
				find: /^tls$/,
				replacement: path.resolve(__dirname, "src/worker/shims/tls.ts"),
			},
			{
				find: /^node:events$/,
				replacement: path.resolve(__dirname, "src/worker/shims/events.ts"),
			},
			{
				find: /^events$/,
				replacement: path.resolve(__dirname, "src/worker/shims/events.ts"),
			},
			{
				find: /^node:stream$/,
				replacement: path.resolve(__dirname, "src/worker/shims/stream.ts"),
			},
			{
				find: /^stream$/,
				replacement: path.resolve(__dirname, "src/worker/shims/stream.ts"),
			},
			{
				find: /^node:net$/,
				replacement: path.resolve(__dirname, "src/worker/shims/net.ts"),
			},
			{
				find: /^net$/,
				replacement: path.resolve(__dirname, "src/worker/shims/net.ts"),
			},
			{
				find: /^node:readline$/,
				replacement: path.resolve(__dirname, "src/worker/shims/readline.ts"),
			},
			{
				find: /^readline$/,
				replacement: path.resolve(__dirname, "src/worker/shims/readline.ts"),
			},
			{
				find: "@silvia-odwyer/photon-node",
				replacement: path.resolve(__dirname, "src/worker/shims/photon-wasm.ts"),
			},
			{
				find: "@resvg/resvg-js",
				replacement: path.resolve(__dirname, "src/worker/shims/node-stubs.ts"),
			},
			{
				find: "@napi-rs/canvas",
				replacement: path.resolve(__dirname, "src/worker/shims/node-stubs.ts"),
			},
			{
				find: "puppeteer-core",
				replacement: path.resolve(__dirname, "src/worker/shims/node-stubs.ts"),
			},
			{
				find: "decode-named-character-reference",
				replacement: path.resolve(
					__dirname,
					"node_modules/decode-named-character-reference/index.js",
				),
			},
			{
				find: "@/src/server/web-subscriptions.ts",
				replacement: path.resolve(
					__dirname,
					"src/worker/shims/web-subscriptions-stub.ts",
				),
			},
			{
				find: "./web-subscriptions.ts",
				replacement: path.resolve(
					__dirname,
					"src/worker/shims/web-subscriptions-stub.ts",
				),
			},
		],
	},
	worker: {
		format: "es",
	},
	build: {
		outDir: mode === "plot3d-smoke" ? "dist-web-plot3d-smoke" : "dist-web",
		...(mode === "plot3d-smoke"
			? {
					rollupOptions: {
						input: path.resolve(__dirname, "plot3d-smoke.html"),
					},
				}
			: {}),
		emptyOutDir: true,
	},
}));
