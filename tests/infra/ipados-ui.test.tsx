import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><head></head><body></body></html>");
const storage = new Map<string, string>();
Object.assign(dom.window, {
	localStorage: {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => storage.set(k, v),
		removeItem: (k: string) => storage.delete(k),
	},
	innerWidth: 500,
});
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	HTMLElement: dom.window.HTMLElement,
	Element: dom.window.Element,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	KeyboardEvent: dom.window.KeyboardEvent,
	localStorage: dom.window.localStorage,
	IS_REACT_ACT_ENVIRONMENT: true,
});

let expandCalls = 0;
(dom.window as unknown as Record<string, unknown>).lh = {
	platform: "ios",
	isIos: true,
	isMobile: true,
	expandWindow: () => {
		expandCalls += 1;
	},
};

const { SidebarProvider, useSidebar, SessionRow } = await import("../../components/shell/sidebar.tsx");

describe("iPadOS CSS gutters and safe-area insets", () => {
	const css = fs.readFileSync(path.resolve("app/globals.css"), "utf8");

	it("preserves the 92px traffic-light gutter on .lh-ios", () => {
		assert.match(css, /\.lh-ios\s+\.lh-lights-gutter\s*\{[^}]*92px[^}]*--lh-sal/);
		assert.match(css, /\.lh-ios\s+\.lh-closed-toggle\s*\{[^}]*92px[^}]*--lh-sal/);
		assert.doesNotMatch(css, /\.lh-ios\s+\.lh-closed-toggle\s*\{[^}]*margin-left:\s*0px/);
	});

	it("applies top, bottom, and horizontal safe-area insets on .lh-ios", () => {
		assert.match(css, /\.lh-ios\s+\.lh-top-bar\s*\{[^}]*--lh-sat/);
		assert.match(css, /\.lh-ios\s+\.lh-top-bar\s*\{[^}]*--lh-sal/);
		assert.match(css, /\.lh-ios\s+\.lh-top-bar\s*\{[^}]*--lh-sar/);
		assert.match(css, /\.lh-ios\s+\.lh-wco-floating\s*\{[^}]*--lh-sat/);
		assert.match(css, /\.lh-ios\s+\.lh-dock-safe\s*\{[^}]*--lh-sab/);
	});
});

describe("iPadOS narrow-width drawer behavior", () => {
	it("auto-closes below 928px and toggles as an overlay drawer without calling expandWindow", async () => {
		expandCalls = 0;
		storage.clear();
		dom.window.innerWidth = 500;
		const container = dom.document.createElement("div");
		dom.document.body.appendChild(container);
		const root = createRoot(container);

		let latest: ReturnType<typeof useSidebar> | null = null;
		function Probe() {
			latest = useSidebar();
			return <span data-testid="probe">{`${latest.drawer}:${latest.open}`}</span>;
		}

		await act(async () => {
			root.render(
				<SidebarProvider>
					<Probe />
				</SidebarProvider>,
			);
		});

		assert.equal(latest!.drawer, true);
		assert.equal(latest!.open, false);

		await act(async () => {
			latest!.toggle();
		});
		assert.equal(latest!.open, true);
		assert.equal(expandCalls, 0);

		await act(async () => {
			const esc = Object.assign(new dom.window.Event("keydown", { bubbles: true }), { key: "Escape" });
			dom.document.dispatchEvent(esc);
		});
		assert.equal(latest!.open, false);

		await act(async () => {
			dom.window.innerWidth = 1024;
			dom.window.dispatchEvent(new dom.window.Event("resize"));
		});
		assert.equal(latest!.drawer, false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});

describe("SessionRow touch menu triggers", () => {
	const chat = {
		id: "c1",
		title: "Linear Algebra",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		kind: "teach" as const,
		phase: "teach" as const,
		busy: false,
		compacting: false,
		pendingQuestion: false,
		pendingProblem: false,
		messageCount: 2,
	};

	it("opens context menu from the more button without opening the session", async () => {
		const container = dom.document.createElement("div");
		dom.document.body.appendChild(container);
		const root = createRoot(container);
		let opened = 0;
		let menuAnchor: HTMLElement | null = null;

		await act(async () => {
			root.render(
				<SessionRow
					chat={chat}
					active={false}
					showMoreButton
					onOpen={() => {
						opened += 1;
					}}
					onOpenMenu={(anchor) => {
						menuAnchor = anchor;
					}}
				/>,
			);
		});

		const more = container.querySelector('[data-testid="session-more"]') as HTMLButtonElement | null;
		assert.ok(more);
		await act(async () => {
			more.click();
		});
		assert.equal(opened, 0);
		assert.equal(menuAnchor, more);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("opens context menu on touch long-press and suppresses click navigation", async () => {
		const container = dom.document.createElement("div");
		dom.document.body.appendChild(container);
		const root = createRoot(container);
		let opened = 0;
		let menuAnchor: HTMLElement | null = null;

		await act(async () => {
			root.render(
				<SessionRow
					chat={chat}
					active={false}
					onOpen={() => {
						opened += 1;
					}}
					onOpenMenu={(anchor) => {
						menuAnchor = anchor;
					}}
				/>,
			);
		});

		const row = container.querySelector('[data-testid="session-row"]') as HTMLButtonElement;
		assert.ok(row);

		const pointerDown = new dom.window.Event("pointerdown", { bubbles: true }) as unknown as Record<string, unknown>;
		pointerDown.pointerType = "touch";
		pointerDown.clientX = 10;
		pointerDown.clientY = 10;

		await act(async () => {
			row.dispatchEvent(pointerDown as unknown as Event);
			await new Promise((r) => setTimeout(r, 550));
		});
		assert.equal(menuAnchor, row);

		await act(async () => {
			row.click();
		});
		assert.equal(opened, 0);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
