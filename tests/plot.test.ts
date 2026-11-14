import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePlotExpression, renderPlot } from "../src/agent/plot.ts";
import type { PlotInput } from "../src/core/contracts/jobs.ts";
import fs from "node:fs";
import { DOMParser } from "linkedom";
import { Resvg } from "@resvg/resvg-js";

test("expressions use mathematical precedence and composed functions", () => {
	assert.equal(evaluatePlotExpression("x^2+1", 2), 5);
	assert.equal(evaluatePlotExpression("-2^2", 0), -4);
	assert.equal(evaluatePlotExpression("2^-2", 0), 0.25);
	assert.ok(
		Math.abs(
			evaluatePlotExpression("20*log10(1/sqrt(1+(x/1000)^2))", 1000) +
				3.0102999566,
		) < 1e-8,
	);
	assert.throws(() => evaluatePlotExpression("globalThis.process.exit()", 1));
});

test("renders stacked expression and data plots with annotations without dynamic code generation", async () => {
	const input: PlotInput = {
		xLabel: "frequency",
		xScale: "log",
		xDomain: [10, 10000],
		panels: [
			{
				title: "Magnitude",
				yLabel: "dB",
				yScale: "linear",
				curves: [
					{ label: "gain", expression: "20*log10(1/sqrt(1+(x/1000)^2))" },
				],
				annotations: [{ x: 1000, y: -3.01, label: "corner" }],
			},
			{
				title: "Phase",
				yLabel: "degrees",
				yScale: "linear",
				curves: [
					{
						label: "points",
						points: [
							{ x: 10, y: 0 },
							{ x: 1000, y: -45 },
							{ x: 10000, y: -84 },
						],
					},
				],
			},
		],
	};
	const original = globalThis.Function;
	try {
		globalThis.Function = (() => {
			throw new Error("dynamic code denied");
		}) as unknown as FunctionConstructor;
		const svg = await renderPlot(input);
		assert.match(svg, /^<svg/);
		assert.match(svg, /Magnitude/);
		assert.match(svg, /Phase/);
		assert.match(svg, /corner/);
	} finally {
		globalThis.Function = original;
	}
});

test("rejects invalid log domains and unsupported expressions", async () => {
	const base: PlotInput = {
		xLabel: "x",
		xScale: "log",
		xDomain: [-1, 1],
		panels: [
			{
				title: "",
				yLabel: "y",
				yScale: "linear",
				curves: [{ label: "y", expression: "x" }],
			},
		],
	};
	await assert.rejects(renderPlot(base), /Invalid x domain/);
	base.xDomain = [1, 10];
	base.panels[0]!.curves[0]!.expression = "unknown(x)";
	await assert.rejects(renderPlot(base), /Unsupported/);
});

const parseSvg = (svg: string): Document =>
	// Linkedom's XML mode leaves named entities encoded in attributes. Its
	// HTML mode matches browser SVG attribute decoding; Resvg checks XML below.
	new DOMParser().parseFromString(svg, "text/html") as unknown as Document;

const layoutCases = JSON.parse(
	fs.readFileSync("tests/fixtures/plot-layout/cases.json", "utf8"),
).cases as { id: string; input: PlotInput }[];

test("saved layout cases embed every label as vector paths and retain numeric geometry", async () => {
	for (const fixture of layoutCases) {
		const original = structuredClone(fixture.input);
		const svg = await renderPlot(fixture.input);
		assert.deepEqual(fixture.input, original);
		const doc = parseSvg(svg);
		assert.equal(
			doc.querySelector("text, foreignObject, image, script"),
			null,
			fixture.id,
		);
		const labels = Array.from(doc.querySelectorAll("svg[aria-label]")).map(
			(e) => e.getAttribute("aria-label"),
		);
		for (const panel of original.panels) {
			for (const text of [
				original.xLabel,
				panel.title,
				panel.yLabel,
				...panel.curves.map((c) => c.label),
				...(panel.annotations ?? []).map((a) => a.label),
			])
				assert.ok(
					labels.includes(text),
					`${fixture.id}: missing label ${text}`,
				);
		}
		assert.ok(
			new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()
				.length > 1000,
		);
		const changed = structuredClone(original);
		changed.xLabel = "$x$";
		for (const panel of changed.panels) {
			panel.title = "A different title $x^2$";
			panel.yLabel = "$y$";
			for (const a of panel.annotations ?? []) a.label = "Another label $x^2$";
		}
		const alternate = parseSvg(await renderPlot(changed));
		const paths = (document: typeof doc) =>
			Array.from(document.querySelectorAll(".mark-line path")).map((p) =>
				p.getAttribute("d"),
			);
		assert.deepEqual(paths(doc), paths(alternate), fixture.id);
		assert.ok(paths(doc).length > 0);
	}
});

test("panel data areas align and crowded labels remain present as numbered callouts", async () => {
	const bode = layoutCases.find((c) => c.id === "07-bode")!.input;
	const svg = await renderPlot(bode);
	const doc = parseSvg(svg);
	const origins = Array.from(doc.querySelectorAll("[data-plot-origin]")).map(
		(n) => n.getAttribute("data-plot-origin")!.split(",").map(Number),
	);
	assert.equal(origins[0]![0], origins[1]![0]);
	assert.ok(origins[1]![1]! > origins[0]![1]! + 250);
	const crowded = structuredClone(layoutCases[0]!.input);
	crowded.panels[0]!.annotations = Array.from({ length: 40 }, (_, i) => ({
		x: 1,
		y: 0.5,
		label: `Overflow label ${i + 1} with a long description $x^2$`,
	}));
	const result = await renderPlot(crowded);
	assert.match(result, /annotation callout|Overflow label/);
	const crowdedDoc = parseSvg(result);
	assert.ok(Number(crowdedDoc.documentElement.getAttribute("height")) > 500);
	for (const a of crowded.panels[0]!.annotations!)
		assert.ok(
			Array.from(crowdedDoc.querySelectorAll("svg[aria-label]")).some(
				(e) => e.getAttribute("aria-label") === a.label,
			),
		);
});

test("invalid math identifies the label field and concurrent exports remain stable", async () => {
	const input = structuredClone(layoutCases[0]!.input);
	input.panels[0]!.title = "$\\notARealCommand$";
	await assert.rejects(renderPlot(input), /panels\[0\]\.title:/);
	input.panels[0]!.title = "$\\sin x$";
	const svg = await Promise.all([
		renderPlot(input),
		renderPlot(input),
		renderPlot(input),
	]);
	assert.equal(svg[0], svg[1]);
	assert.equal(svg[1], svg[2]);
});

const samplingCases = JSON.parse(
	fs.readFileSync("tests/fixtures/plot-sampling/cases.json", "utf8"),
).cases as { id: string; input: PlotInput }[];

const annotationCases = JSON.parse(
	fs.readFileSync("tests/fixtures/plot-annotations/cases.json", "utf8"),
).cases as { id: string; input: PlotInput }[];
test("computed markers align with independently evaluated curves and their sampled geometry", async () => {
	const input = structuredClone(annotationCases[0]!.input);
	const original = structuredClone(input);
	const doc = parseSvg(await renderPlot(input));
	assert.deepEqual(input, original);
	const panel = doc.querySelector('[data-plot-panel="1"]')!;
	const markers = Array.from(
		panel.querySelectorAll('[data-plot-annotations="1"] > circle[r="2.5"]'),
	);
	assert.equal(markers.length, 3);
	const expected = [
		[0.1234, 1],
		[0.1233, Math.exp(-1)],
		[0.1235, Math.exp(-1)],
	];
	const coordinates = Array.from(
		panel.querySelectorAll(".mark-line path"),
	).flatMap((path) =>
		[...path.getAttribute("d")!.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(
			(m) => [Number(m[1]), Number(m[2])],
		),
	);
	for (const [i, [x, y]] of expected.entries()) {
		const cx = ((x! - 0.1232) / 0.0004) * 620,
			cy = (1 - y! / 1.05) * 250;
		assert.ok(Math.abs(Number(markers[i]!.getAttribute("cx")) - cx) < 1e-6);
		assert.ok(Math.abs(Number(markers[i]!.getAttribute("cy")) - cy) < 1e-6);
		assert.ok(
			coordinates.some(
				([px, py]) => Math.abs(px! - cx) < 0.002 && Math.abs(py! - cy) < 0.002,
			),
		);
	}
	const labels = Array.from(panel.querySelectorAll("svg[aria-label]")).map(
		(e) => e.getAttribute("aria-label"),
	);
	assert.ok(labels.some((s) => s?.includes("x\\approx 0.1233")));
	assert.ok(labels.some((s) => s?.includes("x\\approx 0.1235")));
	// Remove old hints: resolved annotation x must itself seed the narrow peak.
	delete input.panels[0]!.curves[0]!.sampleAt;
	const noHints = parseSvg(await renderPlot(input));
	assert.ok(
		noHints
			.querySelector(".mark-line path")!
			.getAttribute("d")!
			.includes(",11.905"),
	);
});

test("free notes render without data-point markers and legacy marker geometry stays identical", async () => {
	const input = structuredClone(annotationCases[1]!.input);
	const doc = parseSvg(await renderPlot(input));
	assert.equal(
		doc.querySelectorAll('[data-plot-annotations="0"] > circle[r="2.5"]')
			.length,
		3,
	);
	assert.ok(
		Array.from(doc.querySelectorAll("svg[aria-label]")).some(
			(e) => e.getAttribute("aria-label") === "Labels use computed values",
		),
	);
	input.panels[0]!.annotations = [{ x: 1, y: 0, label: "Measured" }];
	const before = parseSvg(await renderPlot(input));
	input.panels[0]!.annotations[0]!.kind = "point";
	const after = parseSvg(await renderPlot(input));
	assert.equal(
		before.querySelector('[data-plot-annotations="0"]')!.outerHTML,
		after.querySelector('[data-plot-annotations="0"]')!.outerHTML,
	);
});
test("unmarked quadratic labels contain mathematical superscripts and hinted overview actually reaches its peak", async () => {
	const quadratic = samplingCases.find((c) => c.id === "02-quadratic")!.input;
	const doc = parseSvg(await renderPlot(quadratic));
	const title = Array.from(doc.querySelectorAll("svg[aria-label]")).find(
		(n) => n.getAttribute("aria-label") === "y = x^2 - 4",
	)!;
	assert.ok(title.querySelector('[data-mml-node="msup"]'));
	for (const fixture of samplingCases.filter(
		(c) => c.id.startsWith("10-") || c.id.startsWith("other-"),
	)) {
		const svg = await renderPlot(fixture.input);
		const doc = parseSvg(svg);
		const yCoordinates = Array.from(
			doc.querySelectorAll(".mark-line path"),
		).flatMap((path) =>
			[...path.getAttribute("d")!.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(
				(m) => Number(m[2]),
			),
		);
		assert.ok(Math.min(...yCoordinates) < 20, fixture.id);
		assert.ok(
			new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()
				.length > 1000,
		);
	}
});

test("expression branch domains are respected and measured points are never resampled", async () => {
	const branches = samplingCases.find(
		(c) => c.id === "09-analytic-branches",
	)!.input;
	const doc = parseSvg(await renderPlot(branches));
	assert.equal(doc.querySelectorAll(".mark-line path").length, 2);
	const points: PlotInput = {
		xLabel: "x",
		xScale: "linear",
		xDomain: [0, 4],
		panels: [
			{
				title: "Samples",
				yLabel: "y",
				yScale: "linear",
				curves: [
					{
						label: "measured",
						points: [
							{ x: 0, y: 0 },
							{ x: 1, y: 2 },
							{ x: 2, y: 1 },
							{ x: 3, y: 3 },
							{ x: 4, y: 2 },
						],
					},
				],
			},
		],
	};
	const result = parseSvg(await renderPlot(points));
	assert.equal(
		(
			result
				.querySelector(".mark-line path")!
				.getAttribute("d")!
				.match(/[ML]/g) ?? []
		).length,
		5,
	);
	for (const extra of [{ xDomain: [0, 1] }, { sampleAt: [1] }]) {
		const invalid = structuredClone(points);
		Object.assign(invalid.panels[0]!.curves[0]!, extra);
		await assert.rejects(renderPlot(invalid), /only to expressions/);
	}
	for (const extra of [
		{ xDomain: [-2, 1] },
		{ xDomain: [0.5, 0.5] },
		{ sampleAt: [99] },
	]) {
		const invalid = structuredClone(branches);
		Object.assign(invalid.panels[0]!.curves[0]!, extra);
		await assert.rejects(renderPlot(invalid), /invalid xDomain|sampleAt/);
	}
});

test("curves remain clipped to the data rectangle near a pole", async () => {
	const input = samplingCases.find(
		(c) => c.id === "09-analytic-branches",
	)!.input;
	const svg = await renderPlot(input);
	assert.ok(
		svg.includes("<clipPath"),
		"Case-sensitive SVG clipPath must survive export",
	);
	const doc = parseSvg(svg);
	const [left, top] = doc
		.querySelector("[data-plot-origin]")!
		.getAttribute("data-plot-origin")!
		.split(",")
		.map(Number);
	const png = new Resvg(svg).render();
	const pixels = png.pixels;
	let outside = 0;
	for (let y = 0; y < png.height; y++)
		for (let x = Math.ceil(left!); x < left! + 620; x++) {
			if (y >= top! - 2 && y <= top! + 252) continue;
			const i = (y * png.width + x) * 4;
			const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
			if ((b > r + 40 && g > r + 15) || (r > g + 50 && g > b + 50)) outside++;
		}
	assert.equal(
		outside,
		0,
		"Colored curve strokes must not cover titles or axis labels",
	);
});

test("panels support independent zooms with inherited defaults and panel-relative curve validation", async () => {
	const input = structuredClone(
		samplingCases.find((c) => c.id === "10-independent-panels")!.input,
	);
	const doc = parseSvg(await renderPlot(input));
	const paths = Array.from(doc.querySelectorAll("[data-plot-panel]")).map(
		(panel) => panel.querySelector(".mark-line path")!.getAttribute("d")!,
	);
	const visibleWidth = (path: string) => {
		const xs = [...path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)]
			.filter((m) => Number(m[2]) < 125)
			.map((m) => Number(m[1]));
		return Math.max(...xs) - Math.min(...xs);
	};
	assert.ok(
		visibleWidth(paths[0]!) < 1,
		"overview peak remains subpixel in width",
	);
	assert.ok(
		visibleWidth(paths[1]!) > 400,
		"zoom must expand the peak horizontally",
	);
	const origins = Array.from(doc.querySelectorAll("[data-plot-origin]")).map(
		(n) => n.getAttribute("data-plot-origin")!.split(",")[0],
	);
	assert.equal(origins[0], origins[1]);
	input.panels[1]!.curves[0]!.xDomain = [0, 1];
	await assert.rejects(renderPlot(input), /invalid xDomain/);
	delete input.panels[1]!.curves[0]!.xDomain;
	input.panels[1]!.curves[0]!.sampleAt = [0.5];
	await assert.rejects(renderPlot(input), /sampleAt/);
	delete input.panels[1]!.curves[0]!.sampleAt;
	input.panels[1]!.xDomain = [2, 3];
	input.panels[1]!.curves[0]!.expression = "x";
	input.panels[1]!.annotations = [];
	await renderPlot(input);
	for (const domain of [
		[1, 0],
		[-1, 1],
		[NaN, 1],
	] as [number, number][]) {
		const invalid = structuredClone(input);
		invalid.xScale = "log";
		invalid.xDomain = [0.01, 1];
		invalid.panels[1]!.xDomain = domain;
		await assert.rejects(renderPlot(invalid), /invalid panel x domain/);
	}
});
