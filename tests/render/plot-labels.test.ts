import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "linkedom";
import { Resvg } from "@resvg/resvg-js";
import { typesetPlotLabel } from "../../src/agent/plot-labels.ts";

test("mixed labels render offline vector math in all supported delimiters", async () => {
	for (const s of [
		"Magnitude of $H(jf)$ (dB)",
		"$$\\frac{x^2}{2}$$",
		"\\(\\sin x\\)",
		"\\[x_1\\]",
		"x → 0⁺, −π, voltage (V)",
		"$x < 1$ and $y > 0$",
		"x^2 {literal}_# & 10% \\ cost \\$5",
	]) {
		const label = await typesetPlotLabel(s, "title", 14, 620);
		assert.ok(label.width > 0);
		assert.ok(label.height >= 14);
		const doc = new DOMParser().parseFromString(label.svg, "image/svg+xml");
		assert.ok(doc.querySelector("path"));
		assert.equal(
			doc.querySelector("text, foreignObject, use, image, script"),
			null,
		);
		assert.ok(
			new Resvg(label.svg, { font: { loadSystemFonts: false } })
				.render()
				.asPng().length > 100,
		);
	}
});

test("invalid labels fail with their field rather than producing broken figures", async () => {
	for (const s of [
		"$x",
		"$\\bogus{x}$",
		"$\\frac{1}{$",
		"中文",
		"x".repeat(2049),
		"$\\require{html}$",
	]) {
		await assert.rejects(
			typesetPlotLabel(s, "panels[0].title", 14, 620),
			/panels\[0\]\.title:/,
		);
	}
});

test("label wrapping measures all lines and refuses indivisible oversized math", async () => {
	const source = "A longer plain text label with $x^2$ and some units";
	const wide = await typesetPlotLabel(source, "label", 14, 620);
	const narrow = await typesetPlotLabel(source, "label", 14, 120);
	assert.ok(narrow.height > wide.height);
	assert.ok(narrow.width <= 120);
	await assert.rejects(
		typesetPlotLabel("$12345678901234567890$", "label", 14, 20),
		/wider/,
	);
});

test("formulas retain all operators and operands, and prose retains spaces", async () => {
	const equation = await typesetPlotLabel("$x=1+2$", "label", 14, 620);
	const doc = new DOMParser().parseFromString(equation.svg, "image/svg+xml");
	assert.equal(doc.querySelectorAll('[data-mml-node="mn"]').length, 2);
	assert.equal(doc.querySelectorAll('[data-mml-node="mo"]').length, 2);
	const spaced = await typesetPlotLabel("two words", "label", 14, 620);
	const unspaced = await typesetPlotLabel("twowords", "label", 14, 620);
	assert.ok(spaced.width > unspaced.width + 2);
});

test("repeated and concurrent labels have stable standalone output without global IDs", async () => {
	const labels = await Promise.all(
		Array.from({ length: 8 }, () =>
			typesetPlotLabel("$\\sin x + \\cos x$", "label", 14, 620),
		),
	);
	assert.ok(labels.every((l) => l.svg === labels[0]!.svg));
	assert.doesNotMatch(labels[0]!.svg, /\bid=|\bhref=/);
});

test("unmarked formulas use math glyphs while their original accessibility text is retained", async () => {
	const label = await typesetPlotLabel("y = x^2 - 4", "title", 14, 620);
	assert.equal(label.accessibleText, "y = x^2 - 4");
	const doc = new DOMParser().parseFromString(label.svg, "text/html");
	assert.ok(doc.querySelector('[data-mml-node="msup"]'));
});
