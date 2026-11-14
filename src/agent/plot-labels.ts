import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { MathML } from "@mathjax/src/js/input/mathml.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { MathJaxTexFont } from "@mathjax/mathjax-tex-font/js/svg.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import { formatRecognizedPlotMath } from "./plot-math-format.ts";

export interface PlotLabel {
	svg: string;
	width: number;
	height: number;
	baseline: number;
	accessibleText: string;
}

export const plotXml = (s: string): string =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&apos;",
			})[c]!,
	);
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({
	packages: ["base", "ams", "textmacros"],
	maxBuffer: 4096,
	maxMacros: 1000,
	formatError: (_jax: unknown, error: { message: string }) => {
		throw new Error(error.message);
	},
});
const output = () =>
	new SVG({
		fontCache: "none",
		fontData: MathJaxTexFont,
		mtextInheritFont: false,
		merrorInheritFont: false,
		linebreaks: { inline: false },
	});
const texDocument = mathjax.document("", {
	InputJax: tex,
	OutputJax: output(),
});
const textDocument = mathjax.document("", {
	InputJax: new MathML(),
	OutputJax: output(),
});

type Run = { text: string; math: boolean };
function tokenize(source: string): Run[] {
	const runs: Run[] = [];
	let text = "";
	for (let i = 0; i < source.length;) {
		if (source.startsWith("\\$", i)) {
			text += "$";
			i += 2;
			continue;
		}
		const open = ["$$", "$", "\\(", "\\["].find((s) => source.startsWith(s, i));
		if (!open) {
			text += source[i++]!;
			continue;
		}
		if (text) {
			runs.push({ text, math: false });
			text = "";
		}
		const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
		const start = i + open.length;
		i = start;
		while (i < source.length && !source.startsWith(close, i))
			i += source[i] === "\\" ? 2 : 1;
		if (i >= source.length) throw new Error(`Unclosed ${open} math delimiter`);
		const math = source.slice(start, i);
		if (!math.trim()) throw new Error("Empty math label");
		runs.push({ text: math, math: true });
		i += close.length;
	}
	if (text) runs.push({ text, math: false });
	return runs;
}

// Render literal text as MathML so TeX metacharacters stay literal. Greek and
// Unicode scripts use the font's mathematical glyphs rather than system fonts.
function literalMathML(text: string): string {
	const supers = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾",
		subs = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎",
		basic = "0123456789+-=()";
	let result = "",
		plain = "";
	const flush = () => {
		if (plain)
			result += `<mtext>${plotXml(plain.replaceAll(" ", "\u00a0"))}</mtext>`;
		plain = "";
	};
	for (const c of text) {
		const sup = supers.indexOf(c),
			sub = subs.indexOf(c);
		if (sup >= 0 || sub >= 0) {
			flush();
			const kind = sup >= 0 ? "msup" : "msub";
			result += `<${kind}><mrow/><mtext>${basic[sup >= 0 ? sup : sub]}</mtext></${kind}>`;
		} else if (/[α-ωΑ-Ωϑϕϖϵϱ]/u.test(c)) {
			flush();
			result += `<mi>${c}</mi>`;
		} else plain += c;
	}
	flush();
	return `<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow>${result}</mrow></math>`;
}

interface GlyphRun {
	markup: string;
	width: number;
	ascent: number;
	descent: number;
}
const cache = new Map<string, GlyphRun>();
function glyph(run: Run, fontSize: number): GlyphRun {
	const key = JSON.stringify([run, fontSize]);
	const hit = cache.get(key);
	if (hit) return hit;
	tex.reset();
	const document = run.math ? texDocument : textDocument;
	const node = document.convert(run.math ? run.text : literalMathML(run.text), {
		display: false,
		em: fontSize,
		ex: fontSize / 2,
		containerWidth: 10000,
	});
	const svg = adaptor.tags(node, "svg")[0]!;
	const viewBox = adaptor.getAttribute(svg, "viewBox").split(/\s+/).map(Number);
	if (viewBox.length !== 4 || !viewBox.every(Number.isFinite))
		throw new Error("Invalid math glyph bounds");
	const markup = adaptor
		.serializeXML(svg)
		.replace(/^<svg\b[^>]*>/, "")
		.replace(/<\/svg>$/, "");
	if (/<(?:text|merror|image|foreignObject|script|a|use)\b/i.test(markup))
		throw new Error(
			"Unsupported glyph or label construct; use supported LaTeX math instead",
		);
	const scale = fontSize / 1000;
	const result = {
		markup: `<g transform="scale(${scale})">${markup}</g>`,
		width: viewBox[2]! * scale,
		ascent: -viewBox[1]! * scale,
		descent: (viewBox[1]! + viewBox[3]!) * scale,
	};
	if (cache.size >= 512) cache.delete(cache.keys().next().value!);
	cache.set(key, result);
	return result;
}

/** All glyph measurements and paths come from the same bundled font. */
export async function typesetPlotLabel(
	source: string,
	field: string,
	fontSize: number,
	maxWidth: number,
): Promise<PlotLabel> {
	try {
		if (source.length > 2048)
			throw new Error("Label is too long (maximum 2048 characters)");
		if (
			!Number.isFinite(fontSize) ||
			fontSize <= 0 ||
			!Number.isFinite(maxWidth) ||
			maxWidth <= 0
		)
			throw new Error("Invalid label dimensions");
		const lines: GlyphRun[][] = [[]];
		let width = 0;
		for (const run of tokenize(formatRecognizedPlotMath(source))) {
			const pieces = run.math
				? [run.text]
				: run.text.split(/(\s+)/).filter(Boolean);
			for (const text of pieces) {
				const isSpace = !run.math && /^\s+$/.test(text);
				const item = glyph(
					{ text: isSpace ? " " : text, math: run.math },
					fontSize,
				);
				if (item.width > maxWidth)
					throw new Error(
						"Label contains indivisible text or math wider than the available space; shorten or split it",
					);
				if (
					(!run.math && text.includes("\n")) ||
					(width + item.width > maxWidth && !isSpace)
				) {
					lines.push([]);
					width = 0;
				}
				if (
					isSpace &&
					(!width || width + item.width > maxWidth || text.includes("\n"))
				)
					continue;
				lines.at(-1)!.push(item);
				width += item.width;
			}
		}
		let y = 0,
			totalWidth = 0,
			baseline = 0;
		const content: string[] = [];
		for (const line of lines) {
			const ascent = Math.max(fontSize * 0.8, ...line.map((g) => g.ascent)),
				descent = Math.max(fontSize * 0.2, ...line.map((g) => g.descent));
			if (!baseline) baseline = ascent;
			let x = 0;
			for (const item of line) {
				content.push(
					`<g transform="translate(${x},${y + ascent})">${item.markup}</g>`,
				);
				x += item.width;
			}
			totalWidth = Math.max(totalWidth, x);
			y += ascent + descent + fontSize * 0.2;
		}
		const height = Math.max(fontSize, y - fontSize * 0.2);
		return {
			svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, totalWidth)}" height="${height}" viewBox="0 0 ${Math.max(1, totalWidth)} ${height}" role="img" aria-label="${plotXml(source)}"><title>${plotXml(source)}</title><g fill="#333" stroke="#333" stroke-width="0">${content.join("")}</g></svg>`,
			width: totalWidth,
			height,
			baseline,
			accessibleText: source,
		};
	} catch (error) {
		throw new Error(
			`${field}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** Vega still formats ticks; convert their final glyphs so worker PNGs need no fonts. */
export async function vectorizePlotTicks(source: string): Promise<string> {
	// LiteDOM parses tag names as HTML. Restore source SVG casing before XML
	// serialization (notably clipPath), or valid clipping silently disappears.
	const tagNames = new Map(
		[...source.matchAll(/<([A-Za-z][\w:-]*)(?=[\s/>])/g)].map((m) => [
			m[1]!.toLowerCase(),
			m[1]!,
		]),
	);
	const root = adaptor.body(adaptor.parse(source, "text/html"));
	for (const text of adaptor.tags(root, "text")) {
		const size = Number.parseFloat(
			adaptor.getAttribute(text, "font-size") ?? "10",
		);
		const label = await typesetPlotLabel(
			adaptor.textContent(text),
			"axis tick",
			size,
			200,
		);
		const anchor = adaptor.getAttribute(text, "text-anchor");
		const x =
			anchor === "end"
				? -label.width
				: anchor === "middle"
					? -label.width / 2
					: 0;
		const group = adaptor.node("g", {
			transform: adaptor.getAttribute(text, "transform") ?? "",
			opacity: adaptor.getAttribute(text, "opacity") ?? "1",
			"data-plot-tick": adaptor.textContent(text),
		});
		const positioned = adaptor.node("g", {
			transform: `translate(${x},${-label.baseline})`,
		});
		const glyphs = adaptor.tags(
			adaptor.body(adaptor.parse(label.svg, "text/html")),
			"svg",
		)[0]!;
		adaptor.append(positioned, glyphs);
		adaptor.append(group, positioned);
		adaptor.replace(group, text);
	}
	for (const [lower, original] of tagNames)
		if (lower !== original)
			for (const node of adaptor.tags(root, lower)) node.kind = original;
	return adaptor.serializeXML(adaptor.tags(root, "svg")[0]!);
}
