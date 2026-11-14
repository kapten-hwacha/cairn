"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isIos, isTauri } from "@/src/core";

export interface PencilDrawerResult {
	cancelled: boolean;
	pngBase64?: string | null;
	drawingDataB64?: string | null;
	heightRatio: number;
}

export interface OpenPencilDrawerOptions {
	key: string;
	heightRatio?: number;
}

export interface OpenPencilDrawerOutput {
	cancelled: boolean;
	pngBase64?: string;
	hasDrawing: boolean;
}

const memoryDrawingCache = new Map<string, string>();
let lastHeightRatio = 0.5;

function kvKey(key: string): string {
	return `pencil_drawing:${key}`;
}

export function isPencilKitAvailable(): boolean {
	return isTauri() && isIos();
}

export async function loadSavedPencilDrawing(key: string): Promise<string | undefined> {
	const cached = memoryDrawingCache.get(key);
	if (cached) return cached;
	if (!isTauri()) return undefined;
	try {
		const raw = await invoke<string | null>("lh_kv_get", { key: kvKey(key) });
		if (typeof raw === "string" && raw.length > 0) {
			memoryDrawingCache.set(key, raw);
			return raw;
		}
	} catch {
		// Fall back to in-memory cache only.
	}
	return undefined;
}

export async function savePencilDrawing(key: string, drawingDataB64: string | null | undefined): Promise<void> {
	if (drawingDataB64 && drawingDataB64.length > 0) {
		memoryDrawingCache.set(key, drawingDataB64);
	} else {
		memoryDrawingCache.delete(key);
	}
	if (!isTauri()) return;
	try {
		await invoke("lh_kv_set", {
			key: kvKey(key),
			value: drawingDataB64 ?? "",
		});
	} catch {
		// Ignore KV persistence errors; in-memory cache still preserves strokes.
	}
}

export async function clearSavedPencilDrawing(key: string): Promise<void> {
	await savePencilDrawing(key, null);
}

function setDrawerHeightCssVar(heightPx: number): void {
	if (typeof document === "undefined") return;
	const px = Math.max(0, Math.round(heightPx));
	document.documentElement.style.setProperty("--pencil-drawer-h", `${px}px`);
}

export async function openPencilDrawer(options: OpenPencilDrawerOptions): Promise<OpenPencilDrawerOutput> {
	const initialDrawingB64 = await loadSavedPencilDrawing(options.key);
	const unlisten = await listen<number>("lh://pencil-drawer-height", (event) => {
		setDrawerHeightCssVar(typeof event.payload === "number" ? event.payload : 0);
	});

	try {
		const result = await invoke<PencilDrawerResult>("lh_pencil_open_drawer", {
			initialDrawingB64: initialDrawingB64 ?? null,
			heightRatio: options.heightRatio ?? lastHeightRatio,
		});
		if (typeof result.heightRatio === "number" && result.heightRatio >= 0.4 && result.heightRatio <= 0.6) {
			lastHeightRatio = result.heightRatio;
		}
		await savePencilDrawing(options.key, result.drawingDataB64);
		return {
			cancelled: result.cancelled,
			pngBase64: result.pngBase64 ?? undefined,
			hasDrawing: Boolean(result.drawingDataB64 && result.drawingDataB64.length > 0),
		};
	} finally {
		unlisten();
		setDrawerHeightCssVar(0);
	}
}

export async function closePencilDrawer(): Promise<void> {
	setDrawerHeightCssVar(0);
	if (!isPencilKitAvailable()) return;
	await invoke("lh_pencil_close_drawer");
}
