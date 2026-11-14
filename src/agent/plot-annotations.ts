import type { PlotPanel } from "../core/contracts/jobs.ts";
import {
	compilePlotExpression,
	parsePlotExpression,
	type PlotExpression,
} from "./plot-expression.ts";
import { formatRecognizedPlotMath } from "./plot-math-format.ts";

export interface ResolvedPlotAnnotation {
	x: number;
	y: number;
	label: string;
	marker: boolean;
}

function containsX(node: PlotExpression): boolean {
	switch (node.kind) {
		case "identifier":
			return node.name === "x";
		case "unary":
			return containsX(node.operand);
		case "binary":
			return containsX(node.left) || containsX(node.right);
		case "call":
			return node.arguments.some(containsX);
		case "number":
			return false;
	}
}
const numberMath = (value: number): string => {
	if (value === 0) return "0";
	const [mantissa, exponent] = value.toPrecision(12).split("e");
	// Keep the rounded value as text: rounding Number.MAX_VALUE to a Number
	// again would overflow even though the original coordinate is finite.
	const digits = mantissa!.includes(".")
		? mantissa!.replace(/0+$/, "").replace(/\.$/, "")
		: mantissa!;
	return exponent === undefined
		? digits
		: `${digits}\\times 10^{${Number(exponent)}}`;
};

/** Resolve mathematical anchors before sampling or label placement. */
export function resolvePlotAnnotations(
	panel: PlotPanel,
	options: {
		xDomain: [number, number];
		xScale: "linear" | "log";
		field: string;
	},
): ResolvedPlotAnnotation[] {
	const fail = (field: string, message: string): never => {
		throw new Error(`${field}: ${message}`);
	};
	const ids = new Map<string, PlotPanel["curves"][number]>();
	for (const [i, curve] of panel.curves.entries()) {
		if (curve.id === undefined) continue;
		if (
			typeof curve.id !== "string" ||
			!curve.id.trim() ||
			curve.id.length > 64 ||
			ids.has(curve.id)
		)
			fail(
				`${options.field}.curves[${i}].id`,
				"Expected a nonempty, unique curve id of at most 64 characters",
			);
		ids.set(curve.id, curve);
	}
	if ((panel.annotations?.length ?? 0) > 40)
		fail(`${options.field}.annotations`, "Expected at most 40 annotations");
	return (panel.annotations ?? []).map((annotation, i) => {
		const field = `${options.field}.annotations[${i}]`;
		try {
			let x: number,
				y: number,
				label = annotation.label;
			const semantic =
				annotation.kind === "curve-point" ||
				annotation.kind === "level-crossing";
			if (
				annotation.kind === undefined ||
				annotation.kind === "point" ||
				annotation.kind === "note"
			) {
				({ x, y } = annotation);
			} else if (semantic) {
				if ("y" in annotation)
					throw new Error("Do not supply y for a computed annotation");
				const curve = ids.get(annotation.curveId);
				if (!curve)
					throw new Error(
						`Unknown curveId ${annotation.curveId}; reference a curve id in this panel`,
					);
				if (curve.expression === undefined || curve.points !== undefined)
					throw new Error(
						"Computed annotations require an expression curve; use explicit coordinates for measured data",
					);
				const domain = curve.xDomain ?? options.xDomain;
				const inside = (value: number) =>
					Number.isFinite(value) &&
					value >= domain[0] &&
					value <= domain[1] &&
					value >= options.xDomain[0] &&
					value <= options.xDomain[1] &&
					(options.xScale !== "log" || value > 0);
				const evaluate = compilePlotExpression(curve.expression);
				if (annotation.kind === "curve-point") {
					x = annotation.x;
					if (!inside(x))
						throw new Error("x must lie inside the panel and curve x domains");
					y = evaluate(x);
				} else {
					if (containsX(parsePlotExpression(annotation.level)))
						throw new Error("level must be a constant expression without x");
					const level = compilePlotExpression(annotation.level)(0);
					if (!Number.isFinite(level) || (panel.yScale === "log" && level <= 0))
						throw new Error("level must be finite and positive on log y");
					const bracket = annotation.xBracket;
					if (
						!Array.isArray(bracket) ||
						bracket.length !== 2 ||
						!bracket.every(inside) ||
						bracket[0] >= bracket[1]
					)
						throw new Error(
							"xBracket must be an ascending pair inside the panel and curve x domains",
						);
					[x, y] = crossing(evaluate, level, bracket);
					label += ` — level ${formatRecognizedPlotMath(`y = ${annotation.level}`)}`;
				}
				label += ` — $x\\approx ${numberMath(x)},\\ y\\approx ${numberMath(y)}$`;
			} else {
				throw new Error("Unknown annotation kind");
			}
			if (
				!Number.isFinite(x) ||
				!Number.isFinite(y) ||
				(options.xScale === "log" && x <= 0) ||
				(panel.yScale === "log" && y <= 0)
			)
				throw new Error(
					"Invalid annotation coordinates; require finite values and positive log coordinates",
				);
			return { x, y, label, marker: annotation.kind !== "note" };
		} catch (error) {
			return fail(
				field,
				error instanceof Error ? error.message : String(error),
			);
		}
	});
}

function crossing(
	evaluate: (x: number) => number,
	level: number,
	bracket: [number, number],
): [number, number] {
	let [left, right] = bracket;
	let leftY = evaluate(left);
	const rightY = evaluate(right);
	const tolerance = 1e-10 * Math.max(1, Math.abs(level));
	const matches = (y: number) =>
		Number.isFinite(y) && Math.abs(y - level) <= tolerance;
	const failure = () =>
		new Error(
			"Cannot resolve level crossing; provide a tighter xBracket isolating one crossing on a continuous branch",
		);
	if (!Number.isFinite(leftY) || !Number.isFinite(rightY)) throw failure();
	if (matches(leftY) && matches(rightY))
		throw new Error(
			"Ambiguous xBracket: both endpoints match the level; isolate a single crossing",
		);
	if (matches(leftY)) return [left, leftY];
	if (matches(rightY)) return [right, rightY];
	if (leftY < level === rightY < level) throw failure();
	for (let i = 0; i < 128; i++) {
		const x = left / 2 + right / 2;
		if (x === left || x === right) throw failure();
		const y = evaluate(x);
		if (!Number.isFinite(y)) throw failure();
		if (matches(y)) return [x, y];
		if (y < level === leftY < level) {
			left = x;
			leftY = y;
		} else right = x;
	}
	throw failure();
}
