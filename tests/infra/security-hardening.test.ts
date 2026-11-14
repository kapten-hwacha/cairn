import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-sec-hardening-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { POST: postQuaderno } = await import("../../app/api/quaderno/route.ts");
const { PUT: putPrompt } = await import("../../app/api/settings/prompts/[...segment]/route.ts");
const { POST: postProfiler } = await import("../../app/api/profiler/route.ts");
const { PUT: putChat } = await import("../../app/api/chats/[id]/route.ts");
const { stores } = await import("../../src/server/stores.ts");
const { sanitizeMermaidSvg } = await import("../../components/markdown/mermaid-render.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

function streamedJsonRequest(url: string, method: string, text: string): Request {
	const encoded = new TextEncoder().encode(text);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const chunkSize = 16 * 1024;
			for (let i = 0; i < encoded.length; i += chunkSize) {
				controller.enqueue(encoded.slice(i, i + chunkSize));
			}
			controller.close();
		},
	});
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		body: stream,
		duplex: "half",
	} as RequestInit);
}

describe("SEC-12: Bounded request JSON & field limits on API routes", () => {
	it("POST /api/quaderno rejects bodies > 2 MiB and markdown > 500_000 chars", async () => {
		const oversizedBody = JSON.stringify({
			action: "sendProblem",
			title: "T",
			markdown: "a".repeat(2 * 1024 * 1024 + 1024),
		});
		const resOver = await postQuaderno(streamedJsonRequest("http://localhost/api/quaderno", "POST", oversizedBody));
		assert.equal(resOver.status, 413);

		const overMarkdown = await postQuaderno(
			new Request("http://localhost/api/quaderno", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					action: "sendProblem",
					title: "T",
					markdown: "m".repeat(500_001),
				}),
			}),
		);
		assert.equal(overMarkdown.status, 400);

		const badJson = await postQuaderno(
			new Request("http://localhost/api/quaderno", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{bad",
			}),
		);
		assert.equal(badJson.status, 400);
	});

	it("PUT /api/settings/prompts/[...segment] rejects bodies > 512 KiB and text > 200_000 chars", async () => {
		const ctx = { params: Promise.resolve({ segment: ["system-prompt.md"] }) };

		const oversizedBody = JSON.stringify({ text: "x".repeat(512 * 1024 + 1024) });
		const resOver = await putPrompt(
			streamedJsonRequest("http://localhost/api/settings/prompts/system-prompt.md", "PUT", oversizedBody),
			ctx,
		);
		assert.equal(resOver.status, 413);

		const overText = await putPrompt(
			new Request("http://localhost/api/settings/prompts/system-prompt.md", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "x".repeat(200_001) }),
			}),
			ctx,
		);
		assert.equal(overText.status, 400);

		const badJson = await putPrompt(
			new Request("http://localhost/api/settings/prompts/system-prompt.md", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: "{bad",
			}),
			ctx,
		);
		assert.equal(badJson.status, 400);
	});

	it("POST /api/profiler rejects bodies > 512 KiB and text > 200_000 chars", async () => {
		const oversizedBody = JSON.stringify({ action: "approve", text: "p".repeat(512 * 1024 + 1024) });
		const resOver = await postProfiler(
			streamedJsonRequest("http://localhost/api/profiler", "POST", oversizedBody),
		);
		assert.equal(resOver.status, 413);

		const overText = await postProfiler(
			new Request("http://localhost/api/profiler", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "approve", text: "p".repeat(200_001) }),
			}),
		);
		assert.equal(overText.status, 400);
	});

	it("PUT /api/chats/[id] rejects bodies > 64 KiB and title > 500 chars while accepting valid renames", async () => {
		const chat = await stores.chatStore.createChat("Initial Title");
		const ctx = { params: Promise.resolve({ id: chat.id }) };

		const oversizedBody = JSON.stringify({ title: "t".repeat(64 * 1024 + 512) });
		const resOver = await putChat(
			streamedJsonRequest(`http://localhost/api/chats/${chat.id}`, "PUT", oversizedBody),
			ctx,
		);
		assert.equal(resOver.status, 413);

		const overTitle = await putChat(
			new Request(`http://localhost/api/chats/${chat.id}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "t".repeat(501) }),
			}),
			ctx,
		);
		assert.equal(overTitle.status, 400);

		const badJson = await putChat(
			new Request(`http://localhost/api/chats/${chat.id}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: "{bad",
			}),
			ctx,
		);
		assert.equal(badJson.status, 400);

		const ok = await putChat(
			new Request(`http://localhost/api/chats/${chat.id}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "Renamed Safely" }),
			}),
			ctx,
		);
		assert.equal(ok.status, 200);
		assert.deepEqual(await ok.json(), { title: "Renamed Safely" });
	});
});

describe("SEC-14: sanitizeMermaidSvg defense-in-depth SVG sanitizer", () => {
	it("strips <script>, dangerous <foreignObject> payloads, and inline on*= attributes while keeping safe labels", () => {
		const dirty =
			'<svg viewBox="0 0 100 100" onload="alert(1)">' +
			"<script>alert(1)</script>" +
			"<foreignObject><iframe src=\"https://evil.example\"></iframe></foreignObject>" +
			"<foreignObject><script>alert(2)</script></foreignObject>" +
			'<foreignObject><object data="https://evil.example"></object></foreignObject>' +
			'<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">Safe Node</span></div></foreignObject>' +
			'<g onclick="alert(3)" onmouseover="evil()"><rect width="10" height="10"/><a href="javascript:alert(4)"><text>x</text></a></g>' +
			"</svg>";

		const clean = sanitizeMermaidSvg(dirty);
		assert.equal(/<script\b/i.test(clean), false);
		assert.equal(/<iframe\b/i.test(clean), false);
		assert.equal(/<object\b/i.test(clean), false);
		assert.equal(/\bonload=/i.test(clean), false);
		assert.equal(/\bonclick=/i.test(clean), false);
		assert.equal(/\bonmouseover=/i.test(clean), false);
		assert.equal(/javascript:/i.test(clean), false);
		assert.equal(clean.includes("Safe Node"), true);
		assert.equal(clean.includes('viewBox="0 0 100 100"'), true);
	});
});
