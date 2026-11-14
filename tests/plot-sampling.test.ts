import assert from "node:assert/strict";
import { test } from "node:test";
import {
	samplePlotExpression,
	MAX_PLOT_EVALUATIONS,
	type PlotSamplingOptions,
	type PlotSample,
} from "../src/agent/plot-sampling.ts";

const options: PlotSamplingOptions = {
	xDomain: [0, 1],
	xScale: "linear",
	yScale: "linear",
	yDomain: [0, 1.05],
	width: 620,
	height: 250,
	seedX: [],
};
function interpolate(samples: PlotSample[], x: number): number {
	let lo = 0,
		hi = samples.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (samples[mid]!.x < x) lo = mid;
		else hi = mid;
	}
	const a = samples[lo]!,
		b = samples[hi]!;
	assert.equal(a.segment, b.segment);
	return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

test("off-grid annotated peaks retain the true maximum and refine surrounding geometry", () => {
	for (const center of [0.1234, 0.487321, 0.71903]) {
		let evaluations = 0;
		const f = (x: number) => {
			evaluations++;
			return Math.exp(-(((x - center) / 0.0001) ** 2));
		};
		const samples = samplePlotExpression(f, { ...options, seedX: [center] });
		assert.equal(samples.find((s) => s.x === center)?.y, 1);
		assert.ok(evaluations <= MAX_PLOT_EVALUATIONS);
		for (let i = 0; i <= 1000; i++) {
			const x = center - 0.0004 + (i * 0.0008) / 1000;
			const exact = Math.exp(-(((x - center) / 0.0001) ** 2));
			assert.ok((Math.abs(interpolate(samples, x) - exact) * 250) / 1.05 < 0.6);
		}
	}
});

test("linear, composed and log curves agree with independent analytic references", () => {
	const square = samplePlotExpression((x) => x * x, {
		...options,
		xDomain: [-3, 3],
		yDomain: [-4, 10],
	});
	for (const x of [-2, -0.25, 0, 1, 2])
		assert.ok(Math.abs(interpolate(square, x) - x * x) < 0.001);
	const log = samplePlotExpression((x) => x * x, {
		...options,
		xDomain: [0.1, 100],
		xScale: "log",
		yScale: "log",
		yDomain: [0.01, 10000],
	});
	assert.equal(log[0]!.x, 0.1);
	assert.equal(log.at(-1)!.x, 100);
	assert.ok(log.every((s) => s.x > 0 && s.y > 0));
	const f = (x: number) => Math.exp(-x / 2) * Math.sin(3 * x);
	const composed = samplePlotExpression(f, {
		...options,
		xDomain: [0, 6],
		yDomain: [-1, 1],
	});
	for (let i = 0; i < 600; i++) {
		const x = i / 100;
		assert.ok(Math.abs(interpolate(composed, x) - f(x)) * 125 < 0.6);
	}
});

test("split reciprocal branches resolve curvature without crossing the pole", () => {
	for (const domain of [
		[-1, 0.123],
		[0.123, 1],
	] as [number, number][]) {
		const samples = samplePlotExpression((x) => 1 / (x - 0.123), {
			...options,
			xDomain: domain,
			yDomain: [-20, 20],
		});
		assert.ok(samples.every((s) => s.x !== 0.123 && Number.isFinite(s.y)));
		assert.ok(
			samples.every((s) => (domain[0] === -1 ? s.x < 0.123 : s.x > 0.123)),
		);
		for (let i = 0; i < 1000; i++) {
			const x = domain[0] + ((domain[1] - domain[0]) * (i + 0.5)) / 1000;
			const exact = 1 / (x - 0.123);
			if (Math.abs(exact) < 20)
				assert.ok((Math.abs(interpolate(samples, x) - exact) * 250) / 40 < 0.6);
		}
	}
});

test("nonfinite and invalid-log regions create separate segments", () => {
	const samples = samplePlotExpression(
		(x) => (Math.abs(x - 0.5) < 0.05 ? NaN : x),
		{ ...options },
	);
	assert.ok(new Set(samples.map((s) => s.segment)).size > 1);
	const log = samplePlotExpression((x) => x - 0.5, {
		...options,
		yScale: "log",
		yDomain: [0.001, 1],
	});
	assert.ok(log.every((s) => s.y > 0));
});

test("unresolved visible geometry fails within its evaluation budget", () => {
	let count = 0;
	assert.throws(
		() =>
			samplePlotExpression(
				(x) => {
					count++;
					return Math.sin(1e6 * x);
				},
				{ ...options, yDomain: [-1, 1] },
			),
		/resolve|budget|refinement/,
	);
	assert.ok(count <= MAX_PLOT_EVALUATIONS);
});
