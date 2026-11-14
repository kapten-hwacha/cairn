/**
 * The app's ONE mermaid renderer (the chrome-melt wave, 2026-09-19): both the
 * in-chat block (components/md-blocks.tsx) and the session-scoped focus
 * overlay (components/session-overlay.tsx) render charts through this module
 * — one dark-theme config, one plugin instance, unique render ids. This
 * REPLACES streamdown's internal mermaid path entirely: its fullscreen portal
 * was hard-wired `fixed inset-0` (covering the window-drag bar, X landing in
 * drag territory) with no styling hook, which is what drove the custom
 * component in the first place.
 */

import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "mermaid";

/** The chart's base font size (px) — mermaid sizes ALL text relative to
 *  this, so it's the number the display-width cap (md-blocks) divides by:
 *  a chart shown at its natural width renders text at exactly this size.
 *  Pinned explicitly so a mermaid default change can't silently shift the
 *  cap (owner rule, chrome-melt tweaks wave, 2026-09-19: chart text must
 *  never render larger than the session's own text). */
export const MERMAID_FONT_SIZE = 16;

// The app is dark-only (html.dark in the root layout) — diagrams render in
// mermaid's dark theme. (Moved from ai-elements/message.tsx when the
// renderer became app-owned; the old `mermaid` prop wiring is retired.)
export const mermaidTheme: MermaidConfig = {
	fontFamily: "ui-sans-serif, system-ui, sans-serif",
	fontSize: MERMAID_FONT_SIZE,
	securityLevel: "strict",
	theme: "dark",
};

/** Get the active mermaid theme config based on the document's dark/light mode.
 *  Defaults to "dark" when document is undefined (SSR / Node tests). */
export function getMermaidTheme(): MermaidConfig {
	const isDark = typeof document === "undefined" ? true : document.documentElement.classList.contains("dark");
	return {
		fontFamily: "ui-sans-serif, system-ui, sans-serif",
		fontSize: MERMAID_FONT_SIZE,
		securityLevel: "strict",
		theme: isDark ? "dark" : "default",
	};
}

const plugin = createMermaidPlugin();

const DANGEROUS_ELEMENTS = new Set(["script", "iframe", "object", "embed"]);

function isDangerousHrefValue(value: string): boolean {
	const normalized = value.replace(/[\x00-\x20\x7f]+/g, "").toLowerCase();
	return (
		normalized.startsWith("javascript:") ||
		normalized.startsWith("vbscript:") ||
		normalized.startsWith("data:text/html")
	);
}

function sanitizeSvgRegex(svg: string): string {
	let out = svg;
	// Remove any <foreignObject> containing <script>, <iframe>, <object>, or <embed>.
	let prev = "";
	while (out !== prev) {
		prev = out;
		out = out.replace(
			/<([a-z0-9_-]+:)?foreignObject\b[^>]*>[\s\S]*?<\/\1?foreignObject\s*>/gi,
			(block) =>
				/<\s*(?:[a-z0-9_-]+:)?(?:script|iframe|object|embed)\b/i.test(block) ? "" : block,
		);
		for (const tag of DANGEROUS_ELEMENTS) {
			const paired = new RegExp(
				`<([a-z0-9_-]+:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/\\1?${tag}\\s*>`,
				"gi",
			);
			const selfClosing = new RegExp(`<([a-z0-9_-]+:)?${tag}\\b[^>]*\\/?>`, "gi");
			out = out.replace(paired, "").replace(selfClosing, "");
		}
	}

	// Strip inline on*= event attributes and javascript:/vbscript:/data:text/html URLs inside tags only.
	out = out.replace(
		/<(?!\/)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s>"'/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*\s*\/?)>/g,
		(_full, tagName: string, rawAttrs: string) => {
			if (!rawAttrs) return `<${tagName}>`;
			const selfClose = rawAttrs.trimEnd().endsWith("/");
			const attrBody = selfClose ? rawAttrs.slice(0, rawAttrs.lastIndexOf("/")) : rawAttrs;
			const kept: string[] = [];
			const attrRegex = /([^\s>"'/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;
			let m: RegExpExecArray | null;
			while ((m = attrRegex.exec(attrBody)) !== null) {
				const name = m[1]!;
				const val = m[2];
				const lowerName = name.toLowerCase();
				const localName = lowerName.includes(":") ? lowerName.slice(lowerName.indexOf(":") + 1) : lowerName;
				if (localName.startsWith("on")) continue;
				if (val && (localName === "href" || localName === "src")) {
					const unquoted =
						(val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))
							? val.slice(1, -1)
							: val;
					if (isDangerousHrefValue(unquoted)) continue;
				}
				kept.push(val !== undefined ? `${name}=${val}` : name);
			}
			const attrStr = kept.length > 0 ? ` ${kept.join(" ")}` : "";
			return `<${tagName}${attrStr}${selfClose ? " /" : ""}>`;
		},
	);

	return out;
}

/**
 * Defense-in-depth sanitizer for rendered Mermaid SVG before dangerouslySetInnerHTML:
 * strips <script>, <iframe>, <object>, <embed>, <foreignObject> containing active tags,
 * inline on*= event attributes, and javascript:/vbscript:/data:text/html URLs.
 */
export function sanitizeMermaidSvg(svg: string): string {
	if (!svg) return "";
	if (typeof DOMParser !== "undefined" && typeof XMLSerializer !== "undefined") {
		try {
			const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
			if (!doc.querySelector("parsererror") && doc.documentElement.localName.toLowerCase() === "svg") {
				const toRemove: Element[] = [];
				const all = doc.documentElement.querySelectorAll("*");
				for (const el of all) {
					const local = el.localName.toLowerCase();
					if (DANGEROUS_ELEMENTS.has(local)) {
						toRemove.push(el);
					} else if (local === "foreignobject") {
						const hasDangerousChild = Array.from(el.querySelectorAll("*")).some((child) =>
							DANGEROUS_ELEMENTS.has(child.localName.toLowerCase()),
						);
						if (hasDangerousChild) toRemove.push(el);
					}
				}
				for (const el of toRemove) el.remove();

				const remaining = [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll("*"))];
				for (const el of remaining) {
					for (const attr of Array.from(el.attributes)) {
						const localAttr = attr.localName.toLowerCase();
						if (localAttr.startsWith("on")) {
							el.removeAttributeNode(attr);
						} else if (
							(localAttr === "href" || localAttr === "src") &&
							isDangerousHrefValue(attr.value)
						) {
							el.removeAttributeNode(attr);
						}
					}
				}
				return sanitizeSvgRegex(new XMLSerializer().serializeToString(doc.documentElement));
			}
		} catch {
			// fall through to regex sanitizer
		}
	}
	return sanitizeSvgRegex(svg);
}

/** Render one chart source to an svg string. The id is unique per call —
 *  mermaid caches rendered ids, and a repeated id across charts/renders
 *  returns the stale svg (the bug streamdown's own id minting avoids). */
export async function renderMermaid(chart: string, theme?: MermaidConfig): Promise<string> {
	const id = `lh-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
	const activeTheme = theme ?? getMermaidTheme();
	const { svg } = await plugin.getMermaid(activeTheme).render(id, chart);
	return sanitizeMermaidSvg(svg);
}
