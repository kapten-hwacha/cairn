import { parsePlotExpression, type PlotExpression } from "./plot-expression.ts";

const precedence = (node: PlotExpression): number =>
	node.kind === "binary"
		? node.operator === "^"
			? 4
			: "*/".includes(node.operator)
				? 2
				: 1
		: node.kind === "unary"
			? 3
			: 5;
function wrap(node: PlotExpression, minimum: number): string {
	const value = latex(node);
	return precedence(node) < minimum ? `\\left(${value}\\right)` : value;
}
function latex(node: PlotExpression): string {
	switch (node.kind) {
		case "number":
			return node.raw.replace(
				/[eE]([+-]?\d+)$/,
				(_all, exp: string) => `\\times 10^{${Number(exp)}}`,
			);
		case "identifier":
			return node.name === "pi" ? "\\pi" : node.name;
		case "unary":
			return node.operator + wrap(node.operand, 3);
		case "binary":
			switch (node.operator) {
				case "^":
					return `${wrap(node.left, 5)}^{${latex(node.right)}}`;
				case "/":
					return `\\frac{${latex(node.left)}}{${latex(node.right)}}`;
				case "*":
					return `${wrap(node.left, 2)} \\cdot ${wrap(node.right, 2)}`;
				case "+":
				case "-":
					return `${wrap(node.left, 1)} ${node.operator} ${wrap(node.right, 2)}`;
			}
		case "call": {
			const args = node.arguments.map(latex);
			if (node.name === "sqrt") return `\\sqrt{${args[0]}}`;
			if (node.name === "abs") return `\\left|${args[0]}\\right|`;
			const names: Record<string, string> = {
				log: "\\ln",
				log10: "\\log_{10}",
				asin: "\\arcsin",
				acos: "\\arccos",
				atan: "\\arctan",
				atan2: "\\operatorname{atan2}",
			};
			return `${names[node.name] ?? `\\${node.name}`}\\left(${args.join(", ")}\\right)`;
		}
	}
}

const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const coordinates = new RegExp(
	`\\(\\s*(${number})\\s*,\\s*(${number})\\s*\\)`,
	"g",
);
function plain(source: string, singleVariable: boolean): string {
	const text = source.trim();
	try {
		const parts = text.split(/(<=|>=|=|<|>|≤|≥)/);
		const nodes = parts
			.filter((_, i) => !(i % 2))
			.map((p) => parsePlotExpression(p, "display"));
		if (singleVariable || parts.length > 1 || nodes[0]?.kind !== "identifier") {
			const relations: Record<string, string> = {
				"<=": "\\le",
				">=": "\\ge",
				"≤": "\\le",
				"≥": "\\ge",
			};
			let math = latex(nodes[0]!);
			for (let i = 1; i < parts.length; i += 2)
				math += ` ${relations[parts[i]!] ?? parts[i]} ${latex(nodes[(i + 1) / 2]!)}`;
			return (
				source.slice(0, source.indexOf(text)) +
				`$${math}$` +
				source.slice(source.indexOf(text) + text.length)
			);
		}
	} catch {
		/* Not a completely recognized formula: preserve prose. */
	}
	return source.replace(
		coordinates,
		(_match, x: string, y: string) =>
			`$(${latex(parsePlotExpression(x))}, ${latex(parsePlotExpression(y))})$`,
	);
}

/** Recognize complete formulas only; never guess the meaning of prose fragments. */
export function formatRecognizedPlotMath(source: string): string {
	if (source.length > 2048) return source;
	const runs: { value: string; math: boolean }[] = [];
	let start = 0,
		i = 0;
	while (i < source.length) {
		if (source.startsWith("\\$", i)) {
			i += 2;
			continue;
		}
		const open = ["$$", "$", "\\(", "\\["].find((s) => source.startsWith(s, i));
		if (!open) {
			i++;
			continue;
		}
		if (i > start) runs.push({ value: source.slice(start, i), math: false });
		const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
		const at = i;
		i += open.length;
		while (i < source.length && !source.startsWith(close, i))
			i += source[i] === "\\" ? 2 : 1;
		if (i >= source.length) {
			runs.push({ value: source.slice(at), math: true });
			start = source.length;
			break;
		}
		i += close.length;
		runs.push({ value: source.slice(at, i), math: true });
		start = i;
	}
	if (start < source.length)
		runs.push({ value: source.slice(start), math: false });
	const hasMath = runs.some((r) => r.math);
	return runs
		.map((r) => (r.math ? r.value : plain(r.value, !hasMath)))
		.join("");
}
