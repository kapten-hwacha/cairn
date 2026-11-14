import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderReview } from "../scripts/plot-render-review.ts";

test("render review keeps source evidence intact, makes no requests, and retains per-input failures", async () => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plot-review-"));
	const source = path.join(temp, "source"),
		out = path.join(temp, "review");
	const set = JSON.parse(
		fs.readFileSync("tests/fixtures/plot-benchmark/cases.json", "utf8"),
	);
	const input = JSON.parse(
		fs.readFileSync("tests/fixtures/plot-layout/cases.json", "utf8"),
	).cases[0].input;
	fs.mkdirSync(source);
	fs.writeFileSync(path.join(source, "cases.json"), JSON.stringify(set));
	fs.writeFileSync(
		path.join(source, "manifest.json"),
		JSON.stringify({ repetitions: 1 }),
	);
	for (const c of set.cases) {
		const dir = path.join(source, c.id, "attempt-1");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "jobs.json"),
			JSON.stringify(
				c.id === set.cases[0].id
					? [
							{
								kind: "plot",
								input,
								result: {
									svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>',
								},
							},
							{ kind: "plot", input: { ...input, xDomain: [0] } },
						]
					: [],
			),
		);
	}
	const before = fs
		.readdirSync(source, { recursive: true })
		.filter((file) => fs.statSync(path.join(source, String(file))).isFile())
		.map((file) => [
			String(file),
			fs.readFileSync(path.join(source, String(file)), "utf8"),
		]);
	const original = globalThis.fetch;
	globalThis.fetch = () =>
		assert.fail("Renderer review must not use the network");
	try {
		await assert.rejects(
			renderReview(source, path.join(source, "nested")),
			/outside the source/,
		);
		const result = await renderReview(source, out);
		assert.equal(result.rendered, 1);
		assert.equal(result.failed, 1);
		const details = JSON.parse(
			fs.readFileSync(path.join(out, "results.json"), "utf8"),
		);
		assert.match(details.results[1].error, /Validation failed/);
		assert.ok(fs.readFileSync(result.indexFile, "utf8").includes("Before"));
		const html = fs.readFileSync(result.indexFile, "utf8");
		const images = [...html.matchAll(/<img src="([^"]+)"/g)];
		assert.equal(images.length, 2);
		for (const image of images) {
			assert.ok(image[1]!.startsWith("data:image/png;base64,"));
			assert.equal(
				Buffer.from(image[1]!.split(",")[1]!, "base64")
					.subarray(1, 4)
					.toString(),
				"PNG",
			);
		}
		const variantsFile = path.join(temp, "variants.json");
		const variant = {
			caseId: set.cases[0].id,
			attempt: 1,
			plotIndex: 1,
			input: { ...input, xLabel: "Revised $x$" },
			reason: "Explicitly revised input for review",
		};
		fs.writeFileSync(
			variantsFile,
			JSON.stringify({ schemaVersion: 1, variants: [variant] }),
		);
		const revised = await renderReview(
			source,
			path.join(temp, "variants-review"),
			variantsFile,
		);
		assert.equal(revised.rendered, 2);
		assert.equal(revised.failed, 1);
		const records = JSON.parse(
			fs.readFileSync(path.join(temp, "variants-review/results.json"), "utf8"),
		).results;
		assert.equal(records[0].inputProvenance.kind, "original");
		assert.equal(records[2].inputProvenance.kind, "variant");
		assert.equal(
			records[2].inputProvenance.originalInputHash,
			records[0].sourceHash,
		);
		assert.notEqual(records[2].sourceHash, records[0].sourceHash);
		assert.equal(records[2].inputProvenance.reason, variant.reason);
		assert.ok(
			fs.readFileSync(revised.indexFile, "utf8").includes("Revised input:"),
		);
		for (const variants of [
			[variant, variant],
			[{ ...variant, plotIndex: 999 }],
		]) {
			fs.writeFileSync(
				variantsFile,
				JSON.stringify({ schemaVersion: 1, variants }),
			);
			await assert.rejects(
				renderReview(source, path.join(temp, "invalid-review"), variantsFile),
				/Duplicate variant|Missing variant/,
			);
			assert.equal(fs.existsSync(path.join(temp, "invalid-review")), false);
		}
		for (const [file, content] of before)
			assert.equal(fs.readFileSync(path.join(source, file!), "utf8"), content);
		await assert.rejects(renderReview(source, out), /EEXIST/);
	} finally {
		globalThis.fetch = original;
		fs.rmSync(temp, { recursive: true, force: true });
	}
});
