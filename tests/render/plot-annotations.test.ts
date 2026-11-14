import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlotPanel, PlotAnnotation } from "../../src/core/contracts/jobs.ts";
import { resolvePlotAnnotations } from "../../src/agent/plot-annotations.ts";

const options = {
	xDomain: [0, 1] as [number, number],
	xScale: "linear" as const,
	field: "panels[0]",
};
const base = (): PlotPanel => ({
	title: "Gaussian",
	yLabel: "y",
	yScale: "linear",
	curves: [
		{ id: "g", label: "Gaussian", expression: "exp(-((x-0.1234)/0.0001)^2)" },
	],
});
const cross = (
	xBracket: [number, number],
): Extract<PlotAnnotation, { kind: "level-crossing" }> => ({
	kind: "level-crossing",
	curveId: "g",
	level: "exp(-1)",
	xBracket,
	label: "Width",
});

test("Gaussian anchors and generated labels use computed coordinates without mutating inputs", () => {
	const panel = base();
	panel.annotations = [
		{ kind: "curve-point", curveId: "g", x: 0.1234, label: "Peak" },
		cross([0.1232, 0.1234]),
		cross([0.1234, 0.1236]),
	];
	const original = structuredClone(panel);
	const result = resolvePlotAnnotations(panel, options);
	assert.deepEqual(panel, original);
	assert.equal(result[0]!.y, 1);
	for (const [i, expected] of [0.1233, 0.1235].entries()) {
		assert.ok(Math.abs(result[i + 1]!.x - expected) < 1e-12);
		assert.ok(Math.abs(result[i + 1]!.y - Math.exp(-1)) < 1e-10);
		assert.match(result[i + 1]!.label, /level \$y =/);
		assert.match(result[i + 1]!.label, /x\\approx/);
		assert.equal(result[i + 1]!.marker, true);
	}
	assert.match(result[1]!.label, /0\.1233/);
	assert.match(result[2]!.label, /0\.1235/);
});

test("different centers, widths and levels resolve against independent analytic expectations", () => {
	const panel = base();
	panel.curves[0]!.expression = "exp(-((x-0.71903)/0.013)^2)";
	panel.annotations = [
		{ ...cross([0.65, 0.71903]), level: "0.5" },
		{ ...cross([0.71903, 0.8]), level: "0.5" },
	];
	const result = resolvePlotAnnotations(panel, options);
	const offset = 0.013 * Math.sqrt(Math.log(2));
	for (const [i, sign] of [-1, 1].entries())
		assert.ok(Math.abs(result[i]!.x - (0.71903 + sign * offset)) < 1e-10);
});

test("polynomial crossings, single matching endpoints and log coordinates are supported", () => {
	const panel = base();
	panel.curves[0]!.expression = "x^2";
	panel.annotations = [{ ...cross([0, 1]), level: "0.25" }];
	assert.deepEqual(
		resolvePlotAnnotations(panel, options).map(({ x, y }) => [x, y]),
		[[0.5, 0.25]],
	);
	panel.annotations = [{ ...cross([0.5, 1]), level: "0.25" }];
	assert.equal(resolvePlotAnnotations(panel, options)[0]!.x, 0.5);
	panel.yScale = "log";
	assert.equal(
		resolvePlotAnnotations(panel, {
			...options,
			xDomain: [0.1, 1],
			xScale: "log",
		})[0]!.y,
		0.25,
	);
});

test("legacy points and free notes preserve coordinates while notes omit the data marker", () => {
	const panel = base();
	panel.annotations = [
		{ x: -2, y: -3, label: "Legacy" },
		{ kind: "note", x: 0.5, y: 0.5, label: "Explanation" },
	];
	assert.deepEqual(resolvePlotAnnotations(panel, options), [
		{ x: -2, y: -3, label: "Legacy", marker: true },
		{ x: 0.5, y: 0.5, label: "Explanation", marker: false },
	]);
});

test("computed labels normalize negative zero and typeset scientific notation", () => {
	const panel = base();
	panel.curves[0]!.expression = "-x*1e-20";
	panel.annotations = [
		{ kind: "curve-point", curveId: "g", x: -0, label: "Origin" },
	];
	assert.match(
		resolvePlotAnnotations(panel, options)[0]!.label,
		/y\\approx 0\$/,
	);
	assert.equal(panel.annotations[0]!.kind, "curve-point");
	panel.annotations[0]!.x = 0.5;
	assert.match(
		resolvePlotAnnotations(panel, options)[0]!.label,
		/-5\\times 10\^\{-21\}/,
	);
	panel.curves[0]!.expression = "1.7976931348623157e308";
	assert.match(
		resolvePlotAnnotations(panel, options)[0]!.label,
		/1\.79769313486\\times 10\^\{308\}/,
	);
	assert.doesNotMatch(
		resolvePlotAnnotations(panel, options)[0]!.label,
		/Infinity/,
	);
});

const invalid: [string, (p: PlotPanel) => void, RegExp][] = [
	[
		"unknown reference",
		(p) => {
			p.annotations = [{ ...cross([0, 1]), curveId: "missing" }];
		},
		/Unknown curveId/,
	],
	[
		"duplicate ID",
		(p) => {
			p.curves.push({ ...p.curves[0]! });
		},
		/unique curve id/,
	],
	[
		"blank ID",
		(p) => {
			p.curves[0]!.id = " ";
		},
		/nonempty/,
	],
	[
		"long ID",
		(p) => {
			p.curves[0]!.id = "x".repeat(65);
		},
		/64/,
	],
	[
		"measured curve",
		(p) => {
			delete p.curves[0]!.expression;
			p.curves[0]!.points = [{ x: 0, y: 0 }];
		},
		/expression curve/,
	],
	[
		"outside panel",
		(p) => {
			p.annotations = [{ kind: "curve-point", curveId: "g", x: 2, label: "" }];
		},
		/inside/,
	],
	[
		"outside branch",
		(p) => {
			p.curves[0]!.xDomain = [0.2, 0.5];
		},
		/inside/,
	],
	[
		"variable level",
		(p) => {
			p.annotations = [{ ...cross([0, 1]), level: "x+1" }];
		},
		/constant/,
	],
	[
		"nonfinite level",
		(p) => {
			p.annotations = [{ ...cross([0, 1]), level: "1/0" }];
		},
		/finite/,
	],
	[
		"invalid log level",
		(p) => {
			p.yScale = "log";
			p.annotations = [{ ...cross([0, 1]), level: "0" }];
		},
		/positive/,
	],
	[
		"descending bracket",
		(p) => {
			p.annotations = [cross([0.2, 0.1])];
		},
		/ascending/,
	],
	[
		"outside bracket",
		(p) => {
			p.annotations = [cross([-1, 0.1])];
		},
		/inside/,
	],
	[
		"nonfinite bracket",
		(p) => {
			p.annotations = [cross([0, Infinity])];
		},
		/ascending/,
	],
	[
		"unbracketed crossing",
		(p) => {
			p.annotations = [cross([0, 0.01])];
		},
		/continuous/,
	],
	[
		"nonfinite curve point",
		(p) => {
			p.curves[0]!.expression = "1/(x-0.1234)";
		},
		/finite/,
	],
	[
		"invalid log result",
		(p) => {
			p.curves[0]!.expression = "-1";
			p.yScale = "log";
		},
		/positive/,
	],
	[
		"ambiguous constant",
		(p) => {
			p.curves[0]!.expression = "1";
			p.annotations = [{ ...cross([0, 1]), level: "1" }];
		},
		/Ambiguous/,
	],
	[
		"nonfinite midpoint pole",
		(p) => {
			p.curves[0]!.expression = "1/(x-0.5)";
			p.annotations = [{ ...cross([0, 1]), level: "0" }];
		},
		/continuous/,
	],
	[
		"finite pole sign change",
		(p) => {
			p.curves[0]!.expression = "1/(x-0.123)";
			p.annotations = [{ ...cross([0, 1]), level: "0" }];
		},
		/continuous/,
	],
	[
		"nonfinite endpoint",
		(p) => {
			p.curves[0]!.expression = "log(x)";
			p.annotations = [{ ...cross([0, 1]), level: "-1" }];
		},
		/continuous/,
	],
	[
		"precision exhausted",
		(p) => {
			p.curves[0]!.expression = "(x-0.123)/abs(x-0.123)";
			p.annotations = [{ ...cross([0, 1]), level: "0" }];
		},
		/continuous/,
	],
];
for (const [name, change, error] of invalid)
	test(`rejects ${name} with an actionable field`, () => {
		const panel = base();
		panel.annotations = [
			{ kind: "curve-point", curveId: "g", x: 0.1234, label: "Feature" },
		];
		change(panel);
		assert.throws(() => resolvePlotAnnotations(panel, options), error);
		assert.throws(() => resolvePlotAnnotations(panel, options), /panels\[0\]/);
	});

test("crossing work is bounded for extremely wide brackets", () => {
	const panel = base();
	panel.curves[0]!.expression = "x-1";
	panel.annotations = [{ ...cross([-1e300, 1e300]), level: "0" }];
	assert.throws(
		() =>
			resolvePlotAnnotations(panel, { ...options, xDomain: [-1e300, 1e300] }),
		/continuous/,
	);
});

test("rejects invalid annotation counts and log x coordinates", () => {
	const panel = base();
	panel.annotations = Array.from({ length: 41 }, () => ({
		x: 1,
		y: 1,
		label: "",
	}));
	assert.throws(() => resolvePlotAnnotations(panel, options), /at most 40/);
	panel.annotations = [{ kind: "note", x: 0, y: 1, label: "" }];
	assert.throws(
		() => resolvePlotAnnotations(panel, { ...options, xScale: "log" }),
		/positive log/,
	);
});
