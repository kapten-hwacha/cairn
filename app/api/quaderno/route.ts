/**
 * API route handler for Quaderno Companion round-trip PDF bridge.
 * GET /api/quaderno -> returns daemon and device connection status.
 * POST /api/quaderno -> executes sendProblem or pullPdf actions.
 */

import {
	CustomBodyLimitError,
	executeQuadernoAction,
	getQuadernoStatus,
	readBoundedJson,
} from "@/src/server";
import type { QuadernoActionRequest } from "@/src/core";

const MAX_QUADERNO_BODY_BYTES = 2 * 1024 * 1024;
const MAX_QUADERNO_MARKDOWN_CHARS = 500_000;

export async function GET() {
	const status = await getQuadernoStatus();
	return Response.json(status);
}

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await readBoundedJson(req, MAX_QUADERNO_BODY_BYTES);
	} catch (error) {
		if (error instanceof CustomBodyLimitError) {
			return Response.json(
				{ ok: false, mode: "filesystem", message: "Request body exceeds 2 MiB limit" },
				{ status: 413 },
			);
		}
		return Response.json(
			{ ok: false, mode: "filesystem", message: "Invalid JSON request body" },
			{ status: 400 },
		);
	}

	if (
		!body ||
		typeof body !== "object" ||
		Array.isArray(body) ||
		!("action" in body) ||
		!["sendProblem", "pullPdf"].includes((body as { action?: string }).action ?? "")
	) {
		return Response.json(
			{ ok: false, mode: "filesystem", message: "Invalid or missing action in request body" },
			{ status: 400 },
		);
	}

	const rawMarkdown = (body as { markdown?: unknown }).markdown;
	if (typeof rawMarkdown === "string" && rawMarkdown.length > MAX_QUADERNO_MARKDOWN_CHARS) {
		return Response.json(
			{ ok: false, mode: "filesystem", message: "markdown exceeds 500000 character limit" },
			{ status: 400 },
		);
	}

	const actionReq = body as QuadernoActionRequest;
	const result = await executeQuadernoAction(actionReq);
	return Response.json(result, { status: result.ok ? 200 : 404 });
}
