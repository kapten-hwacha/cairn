import { initWasm } from "@resvg/resvg-wasm";
let wasmInitPromise: Promise<void> | null = null;

export async function ensureResvgWasm(): Promise<void> {
	if (!wasmInitPromise) {
		wasmInitPromise = (async () => {
			try {
				if (typeof process !== "undefined" && process.versions?.node) {
					const fs = await import("node:fs");
					const path = await import("node:path");
					const wasmPath = path.resolve(
						process.cwd(),
						"node_modules/@resvg/resvg-wasm/index_bg.wasm",
					);
					if (fs.existsSync(wasmPath)) {
						const wasmBytes = fs.readFileSync(wasmPath);
						await initWasm(wasmBytes);
						return;
					}
				}
			} catch {
				// Fall back to fetch in browser/worker
			}

			const wasmUrl = new URL(
				"@resvg/resvg-wasm/index_bg.wasm",
				import.meta.url,
			);
			const res = await fetch(wasmUrl);
			const bytes = await res.arrayBuffer();
			await initWasm(bytes);
		})();
	}
	return wasmInitPromise;
}
