import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRecognizedPlotMath } from "../../src/agent/plot-math-format.ts";
import {
	compilePlotExpression,
	parsePlotExpression,
} from "../../src/agent/plot-expression.ts";

test("unmarked equations, expressions and coordinates become math without interpreting prose", () => {
	assert.equal(formatRecognizedPlotMath("y = x^2 - 4"), "$y = x^{2} - 4$");
	assert.equal(formatRecognizedPlotMath("x < 0.123"), "$x < 0.123$");
	assert.equal(formatRecognizedPlotMath("vertex (0, -4)"), "vertex $(0, -4)$");
	assert.equal(formatRecognizedPlotMath("x"), "$x$");
	for (const prose of [
		"minimum",
		"Measured voltage vs. time",
		"Overview: x from 0 to 1",
		"not(a formula)",
		"notes: x^2 might help",
	])
		assert.equal(formatRecognizedPlotMath(prose), prose);
});

test("formatter preserves explicit math and escaped dollars and handles mixed coordinate prose", () => {
	for (const s of [
		"$x^2$",
		"$$x^2$$",
		"\\(x^2\\)",
		"\\[x^2\\]",
		"Price \\$5",
		"$x$ and $y$",
	])
		assert.equal(formatRecognizedPlotMath(s), s);
	assert.equal(formatRecognizedPlotMath("$y$ at (0, -4)"), "$y$ at $(0, -4)$");
});

test("TeX formatting preserves unary, power and subtraction associativity", () => {
	assert.equal(formatRecognizedPlotMath("-2^2"), "$-2^{2}$");
	assert.equal(formatRecognizedPlotMath("(-2)^2"), "$\\left(-2\\right)^{2}$");
	assert.equal(formatRecognizedPlotMath("2^-2"), "$2^{-2}$");
	assert.equal(
		formatRecognizedPlotMath("x-(x-1)"),
		"$x - \\left(x - 1\\right)$",
	);
	assert.match(formatRecognizedPlotMath("exp(−x/2)·sin(3*x)"), /^\$\\exp/);
	assert.match(formatRecognizedPlotMath("π/2"), /\\pi/);
});

test("shared numeric parser keeps the bounded expression grammar and precedence", () => {
	for (const [source, expected] of [
		["-2^2", -4],
		["(-2)^2", 4],
		["2^-2", 0.25],
		["2^3^2", 512],
	] as const)
		assert.equal(compilePlotExpression(source)(0), expected);
	assert.equal(
		compilePlotExpression("exp(-x/2)*sin(3*x)")(2),
		Math.exp(-1) * Math.sin(6),
	);
	assert.throws(() => compilePlotExpression("y+1"));
	assert.equal(parsePlotExpression("y", "display").kind, "identifier");
	assert.throws(() => compilePlotExpression("process.exit()"));
	assert.throws(() => compilePlotExpression("x".repeat(2049)), /too long/);
});
