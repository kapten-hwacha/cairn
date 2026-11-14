import {
	CustomBodyLimitError,
	approveProfilerProposal,
	dismissProfilerProposal,
	getProfilerStatus,
	readBoundedJson,
	runMetacognitiveProfiler,
} from "@/src/server";

export const dynamic = "force-dynamic";

const MAX_PROFILER_BODY_BYTES = 512 * 1024;
const MAX_PROFILER_TEXT_CHARS = 200_000;

export async function GET() {
	const status = await getProfilerStatus();
	return Response.json(status);
}

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await readBoundedJson(req, MAX_PROFILER_BODY_BYTES);
	} catch (error) {
		if (error instanceof CustomBodyLimitError) {
			return Response.json({ error: "Request body exceeds 512 KiB limit" }, { status: 413 });
		}
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return Response.json({ error: "Request body must be an object" }, { status: 400 });
	}

	const { action, text } = body as { action?: unknown; text?: unknown };
	if (typeof text === "string" && text.length > MAX_PROFILER_TEXT_CHARS) {
		return Response.json({ error: "text exceeds 200000 character limit" }, { status: 400 });
	}

	if (action === "analyze") {
		const res = await runMetacognitiveProfiler();
		return Response.json(res);
	}

	if (action === "approve") {
		const res = await approveProfilerProposal(typeof text === "string" ? text : undefined);
		return Response.json(res);
	}

	if (action === "dismiss") {
		const res = await dismissProfilerProposal();
		return Response.json(res);
	}

	return Response.json({ error: "Invalid action" }, { status: 400 });
}
