export interface PlotPoint {
	x: number;
	y: number;
}
export interface PlotRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
export type PlotObstacle =
	| { kind: "point"; point: PlotPoint; radius: number }
	| { kind: "segment"; start: PlotPoint; end: PlotPoint; width: number };
export interface PlotAnnotationLabel {
	id: number;
	anchor: PlotPoint;
	width: number;
	height: number;
}
export interface PlacedPlotLabel extends PlotAnnotationLabel, PlotRect {
	leader: { start: PlotPoint; end: PlotPoint } | null;
}
export interface PlotAnnotationLayout {
	placed: PlacedPlotLabel[];
	overflow: PlotAnnotationLabel[];
}

/** Liang–Barsky intersection: checks the entire segment, not just its ends. */
export function segmentIntersectsRect(
	start: PlotPoint,
	end: PlotPoint,
	rect: PlotRect,
): boolean {
	let lower = 0,
		upper = 1;
	const dx = end.x - start.x,
		dy = end.y - start.y;
	const p = [-dx, dx, -dy, dy],
		q = [
			start.x - rect.x,
			rect.x + rect.width - start.x,
			start.y - rect.y,
			rect.y + rect.height - start.y,
		];
	for (let i = 0; i < 4; i++) {
		if (p[i] === 0) {
			if (q[i]! < 0) return false;
			continue;
		}
		const t = q[i]! / p[i]!;
		if (p[i]! < 0) lower = Math.max(lower, t);
		else upper = Math.min(upper, t);
		if (lower > upper) return false;
	}
	return true;
}
const expand = (r: PlotRect, padding: number): PlotRect => ({
	x: r.x - padding,
	y: r.y - padding,
	width: r.width + 2 * padding,
	height: r.height + 2 * padding,
});
const intersects = (a: PlotRect, b: PlotRect) =>
	a.x <= b.x + b.width &&
	a.x + a.width >= b.x &&
	a.y <= b.y + b.height &&
	a.y + a.height >= b.y;
export function labelHitsObstacle(
	rect: PlotRect,
	obstacle: PlotObstacle,
): boolean {
	if (obstacle.kind === "segment")
		return segmentIntersectsRect(
			obstacle.start,
			obstacle.end,
			expand(rect, 3 + obstacle.width / 2),
		);
	const { point, radius } = obstacle;
	const x = Math.max(rect.x, Math.min(point.x, rect.x + rect.width)),
		y = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
	return Math.hypot(x - point.x, y - point.y) <= radius + 3;
}

export function placePlotAnnotations(
	labels: PlotAnnotationLabel[],
	obstacles: PlotObstacle[],
	width: number,
	height: number,
): PlotAnnotationLayout {
	const placed: PlacedPlotLabel[] = [],
		overflow: PlotAnnotationLabel[] = [];
	const markers: PlotObstacle[] = labels.map((l) => ({
		kind: "point",
		point: l.anchor,
		radius: 4,
	}));
	for (const label of labels) {
		const { anchor: a, width: w, height: h } = label;
		let found = false;
		for (const gap of [8, 16, 28, 44, 68]) {
			const candidates = [
				[a.x + gap, a.y - h - gap],
				[a.x + gap, a.y + gap],
				[a.x - w - gap, a.y - h - gap],
				[a.x - w - gap, a.y + gap],
				[a.x - w / 2, a.y - h - gap],
				[a.x - w / 2, a.y + gap],
				[a.x + gap, a.y - h / 2],
				[a.x - w - gap, a.y - h / 2],
			];
			for (const [x, y] of candidates) {
				const rect = { x: x!, y: y!, width: w, height: h };
				if (
					rect.x < 4 ||
					rect.y < 4 ||
					rect.x + w > width - 4 ||
					rect.y + h > height - 4
				)
					continue;
				if (
					placed.some((p) => intersects(expand(p, 4), rect)) ||
					[...markers, ...obstacles].some((o) => labelHitsObstacle(rect, o))
				)
					continue;
				const end = {
					x: Math.max(rect.x, Math.min(a.x, rect.x + w)),
					y: Math.max(rect.y, Math.min(a.y, rect.y + h)),
				};
				const start = { x: a.x, y: a.y };
				placed.push({ ...label, ...rect, leader: { start, end } });
				found = true;
				break;
			}
			if (found) break;
		}
		if (!found) overflow.push(label);
	}
	return { placed, overflow };
}
