const functions: Record<string, (...args: number[]) => number> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	atan2: Math.atan2,
	sqrt: Math.sqrt,
	abs: Math.abs,
	log: Math.log,
	log10: Math.log10,
	exp: Math.exp,
};
export type PlotExpression =
	| { kind: "number"; raw: string; value: number }
	| { kind: "identifier"; name: string }
	| { kind: "unary"; operator: "+" | "-"; operand: PlotExpression }
	| {
			kind: "binary";
			operator: "+" | "-" | "*" | "/" | "^";
			left: PlotExpression;
			right: PlotExpression;
	  }
	| { kind: "call"; name: string; arguments: PlotExpression[] };

/** A bounded grammar shared by numeric execution and conservative display recognition. */
export function parsePlotExpression(
	source: string,
	mode: "numeric" | "display" | readonly string[] = "numeric",
): PlotExpression {
	if (source.length > 2048) throw new Error("Expression is too long");
	const expression =
		mode === "display"
			? source.replaceAll("−", "-").replace(/[·×]/g, "*").replaceAll("π", "pi")
			: source;
	const tokens =
		expression.match(
			/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z][a-zA-Z0-9]*|[+\-*/^(),]|\S/g,
		) ?? [];
	if (tokens.length > 256) throw new Error("Expression is too complex");
	let pos = 0;
	function primary(): PlotExpression {
		const token = tokens[pos++];
		if (token === "(") {
			const node = sum();
			if (tokens[pos++] !== ")")
				throw new Error("Expected closing parenthesis");
			return node;
		}
		if (token && /^(?:\d|\.)/.test(token)) {
			const value = Number(token);
			if (Number.isFinite(value)) return { kind: "number", raw: token, value };
		}
		if (
			(token === "x" && mode === "numeric") ||
			(Array.isArray(mode) && token && mode.includes(token)) ||
			token === "pi" ||
			token === "e" ||
			(mode === "display" && token && /^[a-zA-Z]$/.test(token))
		)
			return { kind: "identifier", name: token };
		if (token && Object.hasOwn(functions, token) && tokens[pos++] === "(") {
			const args = [sum()];
			while (tokens[pos] === ",") {
				pos++;
				args.push(sum());
			}
			if (tokens[pos++] !== ")" || args.length !== (token === "atan2" ? 2 : 1))
				throw new Error(`Invalid arguments for ${token}`);
			return { kind: "call", name: token, arguments: args };
		}
		throw new Error(
			`Unsupported expression token: ${token ?? "end of expression"}`,
		);
	}
	function power(): PlotExpression {
		const left = primary();
		if (tokens[pos] !== "^") return left;
		pos++;
		return { kind: "binary", operator: "^", left, right: unary() };
	}
	function unary(): PlotExpression {
		if (tokens[pos] === "+" || tokens[pos] === "-") {
			const operator = tokens[pos++] as "+" | "-";
			return { kind: "unary", operator, operand: unary() };
		}
		return power();
	}
	function product(): PlotExpression {
		let left = unary();
		while (tokens[pos] === "*" || tokens[pos] === "/") {
			const operator = tokens[pos++] as "*" | "/";
			left = { kind: "binary", operator, left, right: unary() };
		}
		return left;
	}
	function sum(): PlotExpression {
		let left = product();
		while (tokens[pos] === "+" || tokens[pos] === "-") {
			const operator = tokens[pos++] as "+" | "-";
			left = { kind: "binary", operator, left, right: product() };
		}
		return left;
	}
	const result = sum();
	if (pos !== tokens.length)
		throw new Error(`Unexpected expression token: ${tokens[pos]}`);
	return result;
}

function compile(node: PlotExpression): (x: number) => number {
	switch (node.kind) {
		case "number":
			return () => node.value;
		case "identifier":
			return node.name === "x"
				? (x) => x
				: () => (node.name === "pi" ? Math.PI : Math.E);
		case "unary": {
			const operand = compile(node.operand);
			return node.operator === "-" ? (x) => -operand(x) : operand;
		}
		case "call": {
			const args = node.arguments.map(compile);
			return (x) => functions[node.name]!(...args.map((a) => a(x)));
		}
		case "binary": {
			const left = compile(node.left),
				right = compile(node.right);
			switch (node.operator) {
				case "+":
					return (x) => left(x) + right(x);
				case "-":
					return (x) => left(x) - right(x);
				case "*":
					return (x) => left(x) * right(x);
				case "/":
					return (x) => left(x) / right(x);
				case "^":
					return (x) => left(x) ** right(x);
			}
		}
	}
}
export function compilePlotExpression(source: string): (x: number) => number {
	return compile(parsePlotExpression(source));
}

/** Explicit variable scope for maintained multi-dimensional renderers. */
export function compileScopedPlotExpression(
	source: string,
	variables: readonly string[],
): {
	ast: PlotExpression;
	evaluate: (environment: Readonly<Record<string, number>>) => number;
} {
	const ast = parsePlotExpression(source, variables);
	function evaluate(
		node: PlotExpression,
		environment: Readonly<Record<string, number>>,
	): number {
		switch (node.kind) {
			case "number":
				return node.value;
			case "identifier":
				return node.name === "pi"
					? Math.PI
					: node.name === "e"
						? Math.E
						: environment[node.name]!;
			case "unary":
				return (
					(node.operator === "-" ? -1 : 1) * evaluate(node.operand, environment)
				);
			case "call":
				return functions[node.name]!(
					...node.arguments.map((arg) => evaluate(arg, environment)),
				);
			case "binary": {
				const a = evaluate(node.left, environment),
					b = evaluate(node.right, environment);
				switch (node.operator) {
					case "+":
						return a + b;
					case "-":
						return a - b;
					case "*":
						return a * b;
					case "/":
						return a / b;
					case "^":
						return a ** b;
				}
			}
		}
	}
	return { ast, evaluate: (environment) => evaluate(ast, environment) };
}
