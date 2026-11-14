import { parse, View } from "vega";
import { compile } from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";
import type { PlotInput, PlotPanel } from "../core/contracts/jobs.ts";
import {
	typesetPlotLabel,
	plotXml,
	vectorizePlotTicks,
	type PlotLabel,
} from "./plot-labels.ts";
import { placePlotAnnotations, type PlotObstacle } from "./plot-layout.ts";
import { compilePlotExpression } from "./plot-expression.ts";
import { samplePlotExpression } from "./plot-sampling.ts";
import {
	resolvePlotAnnotations,
	type ResolvedPlotAnnotation,
} from "./plot-annotations.ts";

export function evaluatePlotExpression(expression: string, x: number): number {
	return compilePlotExpression(expression)(x);
}

interface PlotRow {
	x: number;
	y: number;
	label: string;
	segment: string;
	order: number;
}
type ResolvedPanel = Omit<PlotPanel, "annotations"> & {
	annotations: ResolvedPlotAnnotation[];
};
function panelRows(input: PlotInput, panel: ResolvedPanel): PlotRow[] {
	const [min, max] = input.xDomain;
	if (!panel.curves.length || panel.curves.length > 8)
		throw new Error("Expected one to eight curves per panel");
	if (
		panel.yDomain &&
		(!panel.yDomain.every(Number.isFinite) ||
			panel.yDomain[0] >= panel.yDomain[1] ||
			(panel.yScale === "log" && panel.yDomain[0] <= 0))
	)
		throw new Error("Invalid y domain");
	const rows: PlotRow[] = [];
	for (const [curveIndex, curve] of panel.curves.entries()) {
		if ((curve.expression === undefined) === (curve.points === undefined))
			throw new Error("Each curve must have either an expression or points");
		if (curve.points && curve.points.length > 5000)
			throw new Error("Too many points");
		if (
			curve.points?.some(
				(point) =>
					!Number.isFinite(point.x) ||
					!Number.isFinite(point.y) ||
					(input.xScale === "log" && point.x <= 0) ||
					(panel.yScale === "log" && point.y <= 0),
			)
		)
			throw new Error("Invalid data point");
		const rowCount = rows.length;
		if (
			curve.points &&
			(curve.xDomain !== undefined || curve.sampleAt !== undefined)
		)
			throw new Error(
				`Curve ${curve.label}: xDomain and sampleAt apply only to expressions`,
			);
		if (curve.expression !== undefined) {
			const domain = curve.xDomain ?? input.xDomain;
			if (
				domain.length !== 2 ||
				!domain.every(Number.isFinite) ||
				domain[0] >= domain[1] ||
				domain[0] < min ||
				domain[1] > max ||
				(input.xScale === "log" && domain[0] <= 0)
			)
				throw new Error(`Curve ${curve.label}: invalid xDomain`);
			if (
				curve.sampleAt &&
				(curve.sampleAt.length > 128 ||
					curve.sampleAt.some(
						(x) => !Number.isFinite(x) || x < domain[0] || x > domain[1],
					))
			)
				throw new Error(
					`Curve ${curve.label}: sampleAt must contain at most 128 finite coordinates inside xDomain`,
				);
			try {
				const samples = samplePlotExpression(
					compilePlotExpression(curve.expression),
					{
						xDomain: domain,
						xScale: input.xScale,
						yScale: panel.yScale,
						yDomain: panel.yDomain,
						width: 620,
						height: 250,
						seedX: [
							...(curve.sampleAt ?? []),
							...(panel.annotations ?? []).map((a) => a.x),
						],
					},
				);
				for (const [order, sample] of samples.entries())
					rows.push({
						x: sample.x,
						y: sample.y,
						label: curve.label,
						segment: `${curveIndex}-${sample.segment}`,
						order,
					});
			} catch (error) {
				throw new Error(
					`Curve ${curve.label}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} else {
			for (const [order, point] of curve.points!.entries())
				rows.push({
					...point,
					label: curve.label,
					segment: `${curveIndex}-0`,
					order,
				});
		}
		if (rows.length === rowCount)
			throw new Error(`No finite points for curve ${curve.label}`);
	}
	if (!rows.length) throw new Error("No finite points to plot");
	if (
		(panel.annotations?.length ?? 0) > 40 ||
		panel.annotations?.some(
			(a) =>
				!Number.isFinite(a.x) ||
				!Number.isFinite(a.y) ||
				(input.xScale === "log" && a.x <= 0) ||
				(panel.yScale === "log" && a.y <= 0),
		)
	)
		throw new Error("Invalid annotations");
	return rows;
}

const PLOT_WIDTH = 620,
	PLOT_HEIGHT = 250;
const drawLabel = (label: PlotLabel, x: number, y: number) =>
	`<g transform="translate(${x},${y})">${label.svg}</g>`;
interface RenderedPanel {
	body: string;
	width: number;
	height: number;
	origin: [number, number];
	title: PlotLabel;
	xTitle: PlotLabel;
	yTitle: PlotLabel;
	legends: { label: PlotLabel; color: string }[];
	annotationSvg: string;
	callouts: { label: PlotLabel; number: PlotLabel }[];
}

async function renderPanel(
	input: PlotInput,
	sourcePanel: PlotPanel,
	index: number,
): Promise<RenderedPanel> {
	const domain = sourcePanel.xDomain ?? input.xDomain;
	if (
		domain.length !== 2 ||
		!domain.every(Number.isFinite) ||
		domain[0] >= domain[1] ||
		(input.xScale === "log" && domain[0] <= 0)
	)
		throw new Error(`panels[${index}].xDomain: invalid panel x domain`);
	const panel: ResolvedPanel = {
		...sourcePanel,
		annotations: resolvePlotAnnotations(sourcePanel, {
			xDomain: domain,
			xScale: input.xScale,
			field: `panels[${index}]`,
		}),
	};
	const rows = panelRows({ ...input, xDomain: domain }, panel);
	const encoding = {
		x: {
			field: "x",
			type: "quantitative",
			title: null,
			scale: { type: input.xScale, domain, nice: false },
		},
		y: {
			field: "y",
			type: "quantitative",
			title: null,
			scale: {
				type: panel.yScale,
				...(panel.yDomain ? { domain: panel.yDomain, nice: false } : {}),
			},
		},
	};
	const compiled = compile({
		width: PLOT_WIDTH,
		height: PLOT_HEIGHT,
		padding: 0,
		encoding,
		layer: [
			{
				data: { values: rows },
				mark: { type: "line", clip: true },
				encoding: {
					color: { field: "label", type: "nominal", legend: null },
					detail: { field: "segment", type: "nominal" },
					order: { field: "order", type: "quantitative" },
				},
			},
			// Retain annotation contributions to automatic y domains, as before.
			...(panel.annotations?.length
				? [
						{
							data: { values: panel.annotations.map((a) => ({ ...a })) },
							mark: { type: "point", opacity: 0 },
						},
					]
				: []),
		],
	} as never).spec;
	const view = new View(parse(compiled, undefined, { ast: true }), {
		renderer: "none",
		expr: expressionInterpreter,
	});
	try {
		const svg = await vectorizePlotTicks(await view.toSVG());
		const origin = view.origin();
		const width = Number(svg.match(/\bwidth="([\d.]+)"/)![1]),
			height = Number(svg.match(/\bheight="([\d.]+)"/)![1]);
		let body = svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
		// Vega uses process-global clipping IDs; scope them to this panel and make
		// exports stable across concurrent jobs and standalone SVG embedding.
		const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
		for (const [i, id] of ids.entries())
			body = body
				.split(`id="${id}"`)
				.join(`id="plot-panel-${index}-def-${i}"`)
				.split(`url(#${id})`)
				.join(`url(#plot-panel-${index}-def-${i})`);
		const field = `panels[${index}]`;
		const title = await typesetPlotLabel(
			panel.title,
			`${field}.title`,
			16,
			PLOT_WIDTH,
		);
		const xTitle = await typesetPlotLabel(
			input.xLabel,
			"xLabel",
			14,
			PLOT_WIDTH,
		);
		const yTitle = await typesetPlotLabel(
			panel.yLabel,
			`${field}.yLabel`,
			14,
			PLOT_HEIGHT,
		);
		const legends = [];
		for (const [i, curve] of panel.curves.entries()) {
			if (panel.curves.findIndex((c) => c.label === curve.label) !== i)
				continue;
			legends.push({
				label: await typesetPlotLabel(
					curve.label,
					`${field}.curves[${i}].label`,
					13,
					270,
				),
				color: String(view.scale("color")(curve.label)),
			});
		}
		const xScale = view.scale("x"),
			yScale = view.scale("y");
		const obstacles: PlotObstacle[] = [];
		const previous = new Map<string, PlotRow>();
		for (const row of rows) {
			const prev = previous.get(row.segment);
			if (prev)
				obstacles.push({
					kind: "segment",
					start: { x: xScale(prev.x), y: yScale(prev.y) },
					end: { x: xScale(row.x), y: yScale(row.y) },
					width: 2,
				});
			previous.set(row.segment, row);
		}
		const annotations = panel.annotations ?? [],
			labels = [];
		for (const [i, annotation] of annotations.entries())
			labels.push(
				await typesetPlotLabel(
					annotation.label,
					`${field}.annotations[${i}].label`,
					13,
					300,
				),
			);
		const layout = placePlotAnnotations(
			labels.map((l, id) => ({
				id,
				width: l.width,
				height: l.height,
				anchor: {
					x: xScale(annotations[id]!.x),
					y: yScale(annotations[id]!.y),
				},
			})),
			obstacles,
			PLOT_WIDTH,
			PLOT_HEIGHT,
		);
		const marks: string[] = [];
		for (const placed of layout.placed) {
			const { start, end } = placed.leader!;
			marks.push(
				`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#777" stroke-width="0.8"/>`,
				drawLabel(labels[placed.id]!, placed.x, placed.y),
			);
		}
		const callouts = [];
		for (const [i, item] of layout.overflow.entries()) {
			const number = await typesetPlotLabel(
				String(i + 1),
				"annotation callout number",
				11,
				32,
			);
			callouts.push({ label: labels[item.id]!, number });
			const { x, y } = item.anchor;
			marks.push(
				`<circle cx="${x}" cy="${y}" r="8" fill="white" stroke="#555"/>`,
				drawLabel(
					number,
					Math.max(
						0,
						Math.min(PLOT_WIDTH - number.width, x - number.width / 2),
					),
					Math.max(
						0,
						Math.min(PLOT_HEIGHT - number.height, y - number.height / 2),
					),
				),
			);
		}
		const points = annotations
			.filter((a) => a.marker)
			.map(
				(a) =>
					`<circle cx="${xScale(a.x)}" cy="${yScale(a.y)}" r="2.5" fill="#555"/>`,
			)
			.join("");
		const annotationSvg = `<g data-plot-annotations="${index}">${points}${marks.join("")}</g>`;
		return {
			body,
			width,
			height,
			origin,
			title,
			xTitle,
			yTitle,
			legends,
			annotationSvg,
			callouts,
		};
	} finally {
		view.finalize();
	}
}

export async function renderPlot(input: PlotInput): Promise<string> {
	const [min, max] = input.xDomain;
	if (
		!Number.isFinite(min) ||
		!Number.isFinite(max) ||
		min >= max ||
		(input.xScale === "log" && min <= 0)
	)
		throw new Error("Invalid x domain");
	if (!input.panels.length || input.panels.length > 4)
		throw new Error("Expected one to four panels");
	const panels: RenderedPanel[] = [];
	for (const [i, panel] of input.panels.entries())
		panels.push(await renderPanel(input, panel, i));
	const left =
		Math.max(...panels.map((p) => p.origin[0] + p.yTitle.height + 16)) + 12;
	const right = Math.max(
		...panels.map(
			(p) => Math.max(0, ...p.legends.map((l) => l.label.width)) + 50,
		),
	);
	let top = 12;
	const parts: string[] = [];
	for (const [index, panel] of panels.entries()) {
		const plotTop = top + panel.title.height + 16;
		parts.push(
			`<g data-plot-panel="${index}" data-plot-origin="${left},${plotTop}">`,
		);
		parts.push(
			drawLabel(panel.title, left + (PLOT_WIDTH - panel.title.width) / 2, top),
		);
		parts.push(
			`<g transform="translate(${left - panel.origin[0]},${plotTop - panel.origin[1]})">${panel.body}</g>`,
		);
		parts.push(
			`<g transform="translate(${left},${plotTop})">${panel.annotationSvg}</g>`,
		);
		parts.push(
			`<g transform="translate(${left - panel.origin[0] - 10 - panel.yTitle.height},${plotTop + (PLOT_HEIGHT + panel.yTitle.width) / 2}) rotate(-90)">${panel.yTitle.svg}</g>`,
		);
		let legendY = plotTop;
		for (const legend of panel.legends) {
			parts.push(
				`<line x1="${left + PLOT_WIDTH + 18}" y1="${legendY + legend.label.height / 2}" x2="${left + PLOT_WIDTH + 32}" y2="${legendY + legend.label.height / 2}" stroke="${plotXml(legend.color)}" stroke-width="2"/>`,
				drawLabel(legend.label, left + PLOT_WIDTH + 38, legendY),
			);
			legendY += legend.label.height + 8;
		}
		const below = plotTop + panel.height - panel.origin[1] + 10;
		parts.push(
			drawLabel(
				panel.xTitle,
				left + (PLOT_WIDTH - panel.xTitle.width) / 2,
				below,
			),
		);
		top = Math.max(below + panel.xTitle.height + 14, legendY + 8);
		for (const item of panel.callouts) {
			parts.push(
				drawLabel(item.number, left, top),
				drawLabel(item.label, left + 24, top),
			);
			top += Math.max(item.number.height, item.label.height) + 10;
		}
		parts.push("</g>");
		top += 22;
	}
	const width = Math.ceil(left + PLOT_WIDTH + right + 12),
		height = Math.ceil(top);
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${plotXml(input.panels.map((p) => p.title).join("; "))}</title><rect width="${width}" height="${height}" fill="white"/>${parts.join("")}</svg>`;
}
