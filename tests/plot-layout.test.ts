import assert from "node:assert/strict";
import { test } from "node:test";
import {
	labelHitsObstacle,
	placePlotAnnotations,
	segmentIntersectsRect,
	type PlotAnnotationLabel,
	type PlotObstacle,
} from "../src/agent/plot-layout.ts";

test("segment collisions include crossings whose endpoints are outside the label", () => {
	const rect = { x: 10, y: 10, width: 20, height: 10 };
	assert.equal(
		segmentIntersectsRect({ x: 0, y: 15 }, { x: 40, y: 15 }, rect),
		true,
	);
	assert.equal(
		segmentIntersectsRect({ x: 0, y: 0 }, { x: 40, y: 0 }, rect),
		false,
	);
	assert.equal(
		labelHitsObstacle(rect, {
			kind: "point",
			point: { x: 15, y: 15 },
			radius: 3,
		}),
		true,
	);
});

test("edge and curve annotations are placed in bounds without collisions", () => {
	const labels: PlotAnnotationLabel[] = [
		{ id: 0, anchor: { x: 155, y: 95 }, width: 60, height: 18 },
		{ id: 1, anchor: { x: 10, y: 10 }, width: 70, height: 18 },
	];
	const obstacles: PlotObstacle[] = [
		{
			kind: "segment",
			start: { x: 0, y: 100 },
			end: { x: 320, y: 100 },
			width: 2,
		},
	];
	const result = placePlotAnnotations(labels, obstacles, 320, 200);
	assert.equal(result.placed.length, 2);
	for (const p of result.placed) {
		assert.ok(
			p.x >= 0 && p.y >= 0 && p.x + p.width <= 320 && p.y + p.height <= 200,
		);
		assert.ok(!obstacles.some((o) => labelHitsObstacle(p, o)));
		assert.ok(p.leader);
	}
	assert.deepEqual(result, placePlotAnnotations(labels, obstacles, 320, 200));
});

test("crowding preserves labels as ordered overflow callouts", () => {
	const labels = Array.from({ length: 40 }, (_, id) => ({
		id,
		anchor: { x: 50, y: 50 },
		width: 200,
		height: 30,
	}));
	const result = placePlotAnnotations(labels, [], 100, 100);
	assert.equal(result.placed.length, 0);
	assert.deepEqual(
		result.overflow.map((l) => l.id),
		labels.map((l) => l.id),
	);
});
