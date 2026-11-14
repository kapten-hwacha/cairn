export const MAX_PLOT_EVALUATIONS = 8192;
export const MAX_PLOT_REFINEMENT_DEPTH = 20;
export const PLOT_ERROR_PIXELS = 0.5;
export interface PlotSamplingOptions {
	xDomain: [number, number];
	xScale: "linear" | "log";
	yScale: "linear" | "log";
	yDomain?: [number, number];
	width: number;
	height: number;
	seedX: number[];
}
export interface PlotSample {
	x: number;
	y: number;
	segment: number;
}
interface Evaluation {
	t: number;
	x: number;
	y: number;
	valid: boolean;
}

/** Bounded adaptive approximation, with explicit feature seeds and finite gaps. */
export function samplePlotExpression(
	evaluate: (x: number) => number,
	options: PlotSamplingOptions,
): PlotSample[] {
	const {
		xDomain: [min, max],
		xScale,
		yScale,
		height,
	} = options;
	const logMin = Math.log(min),
		logSpan = Math.log(max) - logMin;
	if (
		!Number.isFinite(max - min) ||
		min >= max ||
		(xScale === "log" && min <= 0)
	)
		throw new Error("Invalid sampling domain");
	const toX = (t: number) =>
		t === 0
			? min
			: t === 1
				? max
				: xScale === "log"
					? Math.exp(logMin + t * logSpan)
					: min + t * (max - min);
	const toT = (x: number) =>
		xScale === "log"
			? (Math.log(x) - logMin) / logSpan
			: (x - min) / (max - min);
	const cache = new Map<number, Evaluation>();
	function get(t: number, exactX?: number): Evaluation {
		const hit = cache.get(t);
		if (hit) return hit;
		if (cache.size >= MAX_PLOT_EVALUATIONS)
			throw new Error(
				`Cannot resolve curve within ${MAX_PLOT_EVALUATIONS} evaluation budget; add sampleAt hints or narrow xDomain`,
			);
		const x = exactX ?? toX(t),
			y = evaluate(x),
			valid =
				Number.isFinite(x) && Number.isFinite(y) && (yScale !== "log" || y > 0);
		const result = { t, x, y, valid };
		cache.set(t, result);
		return result;
	}
	// Exact hint coordinates take priority over rounded inverse-axis mappings.
	for (const x of options.seedX)
		if (Number.isFinite(x) && x >= min && x <= max) get(toT(x), x);
	for (let i = 0; i <= 800; i++) get(i / 800);
	const seed = [...cache.values()].sort((a, b) => a.t - b.t);
	const finite = seed
		.filter((p) => p.valid)
		.map((p) => (yScale === "log" ? Math.log(p.y) : p.y));
	const bounds = options.yDomain?.map((y) =>
		yScale === "log" ? Math.log(y) : y,
	);
	const low = bounds?.[0] ?? Math.min(...finite),
		high = bounds?.[1] ?? Math.max(...finite);
	const span = high > low ? high - low : Math.max(1, Math.abs(low));
	const project = (p: Evaluation) =>
		Math.max(
			-1,
			Math.min(
				height + 1,
				(((yScale === "log" ? Math.log(p.y) : p.y) - low) * height) / span,
			),
		);
	function refine(a: Evaluation, b: Evaluation, depth: number): void {
		const probes = [0.25, 0.5, 0.75].map((f) => get(a.t + (b.t - a.t) * f));
		const points = [a, ...probes, b],
			valid = points.filter((p) => p.valid);
		if (!valid.length) return;
		if (valid.length !== points.length) {
			// Undefined endpoints outside the visible y window need no infinite
			// refinement. Other validity changes remain explicit segment gaps.
			if (
				(bounds && valid.every((p) => project(p) <= -1)) ||
				(bounds && valid.every((p) => project(p) >= height + 1))
			)
				return;
			if (depth >= MAX_PLOT_REFINEMENT_DEPTH) return;
			for (let i = 1; i < points.length; i++)
				if (points[i - 1]!.valid || points[i]!.valid)
					refine(points[i - 1]!, points[i]!, depth + 1);
			return;
		}
		const ya = project(a),
			yb = project(b);
		const error = Math.max(
			...probes.map((p, i) =>
				Math.abs(project(p) - (ya + ((yb - ya) * (i + 1)) / 4)),
			),
		);
		if (error <= PLOT_ERROR_PIXELS) return;
		if (depth >= MAX_PLOT_REFINEMENT_DEPTH)
			throw new Error(
				"Cannot resolve visible curve within refinement depth; add sampleAt hints or narrow xDomain",
			);
		for (let i = 1; i < points.length; i++)
			refine(points[i - 1]!, points[i]!, depth + 1);
	}
	for (let i = 1; i < seed.length; i++) refine(seed[i - 1]!, seed[i]!, 0);
	const samples: PlotSample[] = [];
	let segment = 0,
		wasValid = false;
	for (const p of [...cache.values()].sort((a, b) => a.t - b.t)) {
		if (!p.valid) {
			if (wasValid) segment++;
			wasValid = false;
			continue;
		}
		samples.push({ x: p.x, y: p.y, segment });
		wasValid = true;
	}
	return samples;
}
