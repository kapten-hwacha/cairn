/**
 * Direct Node.js SQLite backend for `npm run dev` (Next.js dev server),
 * allowing remote clients (such as the iPadOS Simulator in dev mode) to
 * read and write the Mac Tauri app's `learnharness.db` directly.
 *
 * Disabled automatically when `NODE_ENV === "test"`, in browser/Web Worker
 * contexts, or when the database file does not exist on disk.
 */

import type {
	ChatRecord,
	ChatSearchHit,
	ChatSummary,
	CoverageEntry,
	ExtractionRunUsage,
	FsrsCardRow,
	GraphChain,
	GraphNode,
	GraphRegroup,
	ImageSnapshot,
	JobRecord,
	NodeSearchHit,
	NotesSource,
	Position,
	PracticeHistory,
	PracticeRecord,
	ReviewRating,
	SessionCheckpoint,
	StudyInterval,
} from "../core/contracts.ts";
import { activeProblemOf, danglingQuestionOf } from "../core/native-messages.ts";
import { phaseAt3Lh } from "../core/phases.ts";
import { practiceRecordsFromChat, teachSessionSeedRating } from "../core/review.ts";

export interface SqliteStoreBackend {
	saveChat(record: ChatRecord): void;
	getChat(id: string): ChatRecord | null;
	listChats(): ChatSummary[];
	deleteChat(id: string): boolean;
	searchChats(query: string, limit?: number): ChatSearchHit[];
	saveImageSnapshot(chatId: string, snapshotId: string, image: ImageSnapshot): void;
	getImageSnapshot(chatId: string, snapshotId: string): ImageSnapshot | null;

	appendNode(node: GraphNode): void;
	readNodes(): GraphNode[];
	appendChain(chain: GraphChain): void;
	readChains(): GraphChain[];
	appendCheckpoint(checkpoint: SessionCheckpoint): void;
	readCheckpoints(): SessionCheckpoint[];
	appendCoverage(entry: CoverageEntry): void;
	readCoverage(): CoverageEntry[];
	appendRegroup(regroup: GraphRegroup): void;
	readRegroups(): unknown[];
	upsertSource(source: NotesSource): void;
	readSources(): NotesSource[];
	deleteSources(ids: ReadonlySet<string>): number;
	appendSourceUsage(id: string, entry: ExtractionRunUsage): void;
	readPositions(): Record<string, Position>;
	writePositions(positions: Record<string, Position>): void;
	rewriteLedgers(next: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		checkpoints?: SessionCheckpoint[];
		coverage?: CoverageEntry[];
		regroups?: GraphRegroup[];
	}): void;
	searchNodes(query: string, limit?: number): NodeSearchHit[];
	readPracticeHistory(): PracticeHistory;
	syncFsrsCards(cards: FsrsCardRow[]): void;
	readFsrsCards(dueBeforeMs?: number): FsrsCardRow[];
	getGraphRevision(): number;

	saveJob(job: JobRecord): void;
	getJob(id: string): JobRecord | null;
	listJobs(chatId: string): JobRecord[];
	findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null;
	deleteJobsForChat(chatId: string): number;

	getKv(key: string): unknown | null;
	setKv(key: string, value: unknown): void;

	readIntervals(): unknown[];
	appendIntervals(list: StudyInterval[]): void;

	listPromptOverrides(): string[];
	readPromptOverride(segmentPath: string): string | null;
	writePromptOverride(segmentPath: string, text: string): void;
	deletePromptOverride(segmentPath: string): void;

	readAuthFile(): string | null;
	writeAuthFile(content: string): void;
}

type SqliteDb = {
	exec(sql: string): void;
	prepare(sql: string): {
		run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
		get(...params: unknown[]): Record<string, unknown> | undefined;
		all(...params: unknown[]): Record<string, unknown>[];
	};
};

let cachedPromise: Promise<SqliteStoreBackend | null> | null = null;

function parseJson<T>(raw: unknown, fallback: T): T {
	if (typeof raw !== "string" || !raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function rowToChatRecord(row: Record<string, unknown>): ChatRecord {
	const record: ChatRecord = {
		id: String(row.id),
		version: Number(row.version ?? 1),
		title: String(row.title ?? ""),
		kind: (row.kind === "practice" ? "practice" : "teach") as ChatRecord["kind"],
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
		messages: parseJson(row.messages_json, []),
	};
	const tree = parseJson(row.tree_json, undefined);
	if (tree !== undefined && tree !== null) record.tree = tree;
	const settings = parseJson(row.settings_json, undefined);
	if (settings !== undefined && settings !== null) record.settings = settings;
	const turns = parseJson(row.turns_json, undefined);
	if (turns !== undefined && turns !== null) record.turns = turns;
	const extractions = parseJson(row.extractions_json, undefined);
	if (extractions !== undefined && extractions !== null) record.extractions = extractions;
	const clarifications = parseJson(row.clarifications_json, undefined);
	if (clarifications !== undefined && clarifications !== null) record.clarifications = clarifications;
	return record;
}

function buildBackend(
	db: SqliteDb,
	authFile: { read: () => string | null; write: (content: string) => void },
): SqliteStoreBackend {
	const bumpRevision = () => {
		db.prepare("INSERT INTO graph_events (event_json) VALUES (?)").run(
			JSON.stringify({ type: "revision", at: new Date().toISOString() }),
		);
	};

	const withTx = <T>(fn: () => T): T => {
		db.exec("BEGIN IMMEDIATE");
		try {
			const res = fn();
			db.exec("COMMIT");
			return res;
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
	};

	const backend: SqliteStoreBackend = {
		saveChat(record) {
			const kind = record.kind ?? "teach";
			const phase = phaseAt3Lh(record.messages);
			const pendingQuestion = danglingQuestionOf(record.messages) !== null ? 1 : 0;
			const pendingProblem = kind === "practice" && activeProblemOf(record.messages) !== null ? 1 : 0;
			const seedRating = teachSessionSeedRating(record.messages);
			db.prepare(
				`INSERT INTO chats (
					id, version, title, kind, created_at, updated_at, message_count, phase,
					pending_question, pending_problem, seed_rating, messages_json, tree_json,
					settings_json, turns_json, extractions_json, clarifications_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					version = excluded.version,
					title = excluded.title,
					kind = excluded.kind,
					created_at = excluded.created_at,
					updated_at = excluded.updated_at,
					message_count = excluded.message_count,
					phase = excluded.phase,
					pending_question = excluded.pending_question,
					pending_problem = excluded.pending_problem,
					seed_rating = excluded.seed_rating,
					messages_json = excluded.messages_json,
					tree_json = excluded.tree_json,
					settings_json = excluded.settings_json,
					turns_json = excluded.turns_json,
					extractions_json = excluded.extractions_json,
					clarifications_json = excluded.clarifications_json`,
			).run(
				record.id,
				record.version ?? 1,
				record.title,
				kind,
				record.createdAt,
				record.updatedAt,
				record.messages.length,
				phase,
				pendingQuestion,
				pendingProblem,
				seedRating,
				JSON.stringify(record.messages),
				record.tree !== undefined ? JSON.stringify(record.tree) : null,
				record.settings !== undefined ? JSON.stringify(record.settings) : null,
				record.turns !== undefined ? JSON.stringify(record.turns) : null,
				record.extractions !== undefined ? JSON.stringify(record.extractions) : null,
				record.clarifications !== undefined ? JSON.stringify(record.clarifications) : null,
			);
		},

		getChat(id) {
			const row = db.prepare("SELECT * FROM chats WHERE id = ?").get(id);
			return row ? rowToChatRecord(row) : null;
		},

		listChats() {
			const rows = db
				.prepare(
					`SELECT id, title, kind, created_at, updated_at, message_count, phase, pending_question, pending_problem, settings_json
					 FROM chats ORDER BY updated_at DESC`,
				)
				.all();
			return rows.map((row) => {
				const settings = parseJson(row.settings_json, undefined);
				return {
					id: String(row.id),
					title: String(row.title),
					createdAt: String(row.created_at),
					updatedAt: String(row.updated_at),
					kind: (row.kind === "practice" ? "practice" : "teach") as ChatSummary["kind"],
					messageCount: Number(row.message_count ?? 0),
					phase: String(row.phase ?? "probe") as ChatSummary["phase"],
					pendingQuestion: Boolean(row.pending_question),
					pendingProblem: Boolean(row.pending_problem),
					...(settings !== undefined && settings !== null ? { settings } : {}),
				};
			});
		},

		deleteChat(id) {
			const res = db.prepare("DELETE FROM chats WHERE id = ?").run(id);
			return res.changes > 0;
		},

		searchChats(query, limit = 20) {
			const trimmed = query.trim().toLowerCase();
			if (!trimmed) return [];
			const rows = db
				.prepare("SELECT id, title, updated_at, messages_json FROM chats ORDER BY updated_at DESC")
				.all();
			const hits: ChatSearchHit[] = [];
			for (const row of rows) {
				if (hits.length >= limit) break;
				const title = String(row.title ?? "");
				let snippet: string | null = null;
				if (title.toLowerCase().includes(trimmed)) {
					snippet = title;
				} else {
					const messages = parseJson<Array<{ content?: unknown }>>(row.messages_json, []);
					for (const msg of messages) {
						const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
						const idx = text.toLowerCase().indexOf(trimmed);
						if (idx !== -1) {
							const start = Math.max(0, idx - 40);
							const end = Math.min(text.length, idx + trimmed.length + 40);
							snippet = (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
							break;
						}
					}
				}
				if (snippet) {
					hits.push({
						chatId: String(row.id),
						title,
						snippet,
					});
				}
			}
			return hits;
		},

		saveImageSnapshot(chatId, snapshotId, image) {
			db.prepare(
				`INSERT INTO chat_image_snapshots (chat_id, snapshot_id, mime_type, data_base64, width, height)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(chat_id, snapshot_id) DO UPDATE SET
					mime_type = excluded.mime_type,
					data_base64 = excluded.data_base64,
					width = excluded.width,
					height = excluded.height`,
			).run(chatId, snapshotId, image.mimeType, image.data, image.width, image.height);
		},

		getImageSnapshot(chatId, snapshotId) {
			const row = db
				.prepare("SELECT mime_type, data_base64, width, height FROM chat_image_snapshots WHERE chat_id = ? AND snapshot_id = ?")
				.get(chatId, snapshotId);
			if (!row) return null;
			return {
				mimeType: (row.mime_type === "image/jpeg" ? "image/jpeg" : "image/png") as ImageSnapshot["mimeType"],
				data: String(row.data_base64),
				width: Number(row.width),
				height: Number(row.height),
			};
		},

		appendNode(node) {
			withTx(() => {
				db.prepare(
					`INSERT INTO graph_nodes (id, name, statement, aliases_json, created_at, provenance_json)
					 VALUES (?, ?, ?, ?, ?, ?)`,
				).run(
					node.id,
					node.name,
					node.statement,
					JSON.stringify(node.aliases ?? []),
					node.createdAt,
					JSON.stringify(node.provenance ?? {}),
				);
				bumpRevision();
			});
		},

		readNodes() {
			const rows = db
				.prepare("SELECT id, name, statement, aliases_json, created_at, provenance_json FROM graph_nodes ORDER BY seq ASC")
				.all();
			return rows.map((row) => ({
				id: String(row.id),
				name: String(row.name),
				statement: String(row.statement),
				aliases: parseJson<string[]>(row.aliases_json, []),
				createdAt: String(row.created_at),
				provenance: parseJson<GraphNode["provenance"]>(row.provenance_json, []),
			}));
		},

		appendChain(chain) {
			withTx(() => {
				db.prepare(
					`INSERT INTO graph_chains (id, premises_json, conclusion, provenance_json, created_at)
					 VALUES (?, ?, ?, ?, ?)`,
				).run(
					chain.id,
					JSON.stringify(chain.premises ?? []),
					chain.conclusion,
					JSON.stringify(chain.provenance ?? {}),
					chain.createdAt,
				);
				bumpRevision();
			});
		},

		readChains() {
			const rows = db
				.prepare("SELECT id, premises_json, conclusion, provenance_json, created_at FROM graph_chains ORDER BY seq ASC")
				.all();
			return rows.map((row) => ({
				id: String(row.id),
				premises: parseJson<string[]>(row.premises_json, []),
				conclusion: String(row.conclusion),
				provenance: parseJson<GraphNode["provenance"]>(row.provenance_json, []),
				createdAt: String(row.created_at),
			}));
		},

		appendCheckpoint(checkpoint) {
			db.prepare("INSERT INTO graph_checkpoints (chat_id, folded_at) VALUES (?, ?)").run(
				checkpoint.chatId,
				checkpoint.foldedAt,
			);
		},

		readCheckpoints() {
			const rows = db.prepare("SELECT chat_id, folded_at FROM graph_checkpoints ORDER BY seq ASC").all();
			return rows.map((row) => ({
				chatId: String(row.chat_id),
				foldedAt: String(row.folded_at),
			}));
		},

		appendCoverage(entry) {
			db.prepare("INSERT INTO graph_coverage (chat_id, fp, tokens, folded_at) VALUES (?, ?, ?, ?)").run(
				entry.chatId,
				entry.fp,
				entry.tokens,
				entry.foldedAt,
			);
		},

		readCoverage() {
			const rows = db.prepare("SELECT chat_id, fp, tokens, folded_at FROM graph_coverage ORDER BY seq ASC").all();
			return rows.map((row) => ({
				chatId: String(row.chat_id),
				fp: String(row.fp),
				tokens: Number(row.tokens),
				foldedAt: String(row.folded_at),
			}));
		},

		appendRegroup(regroup) {
			withTx(() => {
				db.prepare(
					`INSERT INTO graph_regroups (id, node_id, target_session_id, reason, regrouped_at)
					 VALUES (?, ?, ?, ?, ?)`,
				).run(regroup.id, regroup.nodeId, regroup.targetSessionId, regroup.reason, regroup.regroupedAt);
				bumpRevision();
			});
		},

		readRegroups() {
			const rows = db
				.prepare("SELECT id, node_id, target_session_id, reason, regrouped_at FROM graph_regroups ORDER BY seq ASC")
				.all();
			return rows.map((row) => ({
				id: String(row.id),
				nodeId: String(row.node_id),
				targetSessionId: String(row.target_session_id),
				reason: String(row.reason),
				regroupedAt: String(row.regrouped_at),
			}));
		},

		upsertSource(source) {
			db.prepare(
				`INSERT INTO graph_sources (id, file_path, imported_at, extractions_json)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
					file_path = excluded.file_path,
					imported_at = excluded.imported_at,
					extractions_json = excluded.extractions_json`,
			).run(
				source.id,
				source.filePath,
				source.importedAt,
				source.extractions !== undefined ? JSON.stringify(source.extractions) : null,
			);
		},

		readSources() {
			const rows = db.prepare("SELECT id, file_path, imported_at, extractions_json FROM graph_sources").all();
			return rows.map((row) => {
				const extractions = parseJson<ExtractionRunUsage[] | undefined>(row.extractions_json, undefined);
				return {
					id: String(row.id),
					filePath: String(row.file_path),
					importedAt: String(row.imported_at),
					...(extractions !== undefined ? { extractions } : {}),
				};
			});
		},

		deleteSources(ids) {
			if (ids.size === 0) return 0;
			let deleted = 0;
			const stmt = db.prepare("DELETE FROM graph_sources WHERE id = ?");
			withTx(() => {
				for (const id of ids) {
					deleted += stmt.run(id).changes;
				}
			});
			return deleted;
		},

		appendSourceUsage(id, entry) {
			const row = db.prepare("SELECT extractions_json FROM graph_sources WHERE id = ?").get(id);
			if (!row) return;
			const existing = parseJson<ExtractionRunUsage[]>(row.extractions_json, []);
			existing.push(entry);
			db.prepare("UPDATE graph_sources SET extractions_json = ? WHERE id = ?").run(JSON.stringify(existing), id);
		},

		readPositions() {
			const rows = db.prepare("SELECT node_id, x, y FROM graph_positions").all();
			const out: Record<string, Position> = {};
			for (const row of rows) {
				out[String(row.node_id)] = { x: Number(row.x), y: Number(row.y) };
			}
			return out;
		},

		writePositions(positions) {
			withTx(() => {
				db.exec("DELETE FROM graph_positions");
				const stmt = db.prepare("INSERT INTO graph_positions (node_id, x, y) VALUES (?, ?, ?)");
				for (const [nodeId, pos] of Object.entries(positions)) {
					stmt.run(nodeId, pos.x, pos.y);
				}
			});
		},

		rewriteLedgers(next) {
			withTx(() => {
				if (next.nodes !== undefined) {
					db.exec("DELETE FROM graph_nodes");
					const nodeStmt = db.prepare(
						"INSERT INTO graph_nodes (id, name, statement, aliases_json, created_at, provenance_json) VALUES (?, ?, ?, ?, ?, ?)",
					);
					for (const n of next.nodes) {
						nodeStmt.run(
							n.id,
							n.name,
							n.statement,
							JSON.stringify(n.aliases ?? []),
							n.createdAt,
							JSON.stringify(n.provenance ?? {}),
						);
					}
				}
				if (next.chains !== undefined) {
					db.exec("DELETE FROM graph_chains");
					const chainStmt = db.prepare(
						"INSERT INTO graph_chains (id, premises_json, conclusion, provenance_json, created_at) VALUES (?, ?, ?, ?, ?)",
					);
					for (const c of next.chains) {
						chainStmt.run(
							c.id,
							JSON.stringify(c.premises ?? []),
							c.conclusion,
							JSON.stringify(c.provenance ?? {}),
							c.createdAt,
						);
					}
				}
				if (next.checkpoints !== undefined) {
					db.exec("DELETE FROM graph_checkpoints");
					const cpStmt = db.prepare("INSERT INTO graph_checkpoints (chat_id, folded_at) VALUES (?, ?)");
					for (const cp of next.checkpoints) {
						cpStmt.run(cp.chatId, cp.foldedAt);
					}
				}
				if (next.coverage !== undefined) {
					db.exec("DELETE FROM graph_coverage");
					const covStmt = db.prepare("INSERT INTO graph_coverage (chat_id, fp, tokens, folded_at) VALUES (?, ?, ?, ?)");
					for (const cov of next.coverage) {
						covStmt.run(cov.chatId, cov.fp, cov.tokens, cov.foldedAt);
					}
				}
				if (next.regroups !== undefined) {
					db.exec("DELETE FROM graph_regroups");
					const rgStmt = db.prepare(
						"INSERT INTO graph_regroups (id, node_id, target_session_id, reason, regrouped_at) VALUES (?, ?, ?, ?, ?)",
					);
					for (const rg of next.regroups) {
						rgStmt.run(rg.id, rg.nodeId, rg.targetSessionId, rg.reason, rg.regroupedAt);
					}
				}
				bumpRevision();
			});
		},

		searchNodes(query, limit = 20) {
			const trimmed = query.trim().toLowerCase();
			if (!trimmed) return [];
			const hits: NodeSearchHit[] = [];
			for (const node of backend.readNodes()) {
				if (hits.length >= limit) break;
				const nameMatch = node.name.toLowerCase().includes(trimmed);
				const stmtMatch = node.statement.toLowerCase().includes(trimmed);
				const aliasMatch = (node.aliases ?? []).some((a) => a.toLowerCase().includes(trimmed));
				if (nameMatch || stmtMatch || aliasMatch) {
					hits.push({
						nodeId: node.id,
						name: node.name,
						statement: node.statement,
						snippet: stmtMatch ? node.statement : node.name,
					});
				}
			}
			return hits;
		},

		readPracticeHistory() {
			const teachChatIds = new Set<string>();
			const teachRatings = new Map<string, ReviewRating>();
			const records: PracticeRecord[] = [];
			const rows = db.prepare("SELECT * FROM chats").all();
			for (const row of rows) {
				const chat = rowToChatRecord(row);
				if ((chat.kind ?? "teach") === "practice") {
					records.push(...practiceRecordsFromChat(chat.id, chat.messages));
				} else {
					teachChatIds.add(chat.id);
					teachRatings.set(chat.id, teachSessionSeedRating(chat.messages));
				}
			}
			return { records, teachChatIds, teachRatings };
		},

		syncFsrsCards(cards) {
			withTx(() => {
				db.exec("DELETE FROM fsrs_cards");
				const stmt = db.prepare(
					`INSERT INTO fsrs_cards (node_id, stability, difficulty, last_review_ms, reviews, due_at_ms, lane, seed_rating, stage)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				);
				for (const card of cards) {
					stmt.run(
						card.nodeId,
						card.stability,
						card.difficulty,
						card.lastReviewMs,
						card.reviews,
						card.dueAtMs,
						card.lane,
						card.seedRating,
						card.stage,
					);
				}
			});
		},

		readFsrsCards(dueBeforeMs) {
			const rows =
				dueBeforeMs !== undefined
					? db.prepare("SELECT * FROM fsrs_cards WHERE due_at_ms <= ? ORDER BY due_at_ms ASC").all(dueBeforeMs)
					: db.prepare("SELECT * FROM fsrs_cards ORDER BY due_at_ms ASC").all();
			return rows.map((row) => ({
				nodeId: String(row.node_id),
				stability: row.stability === null ? null : Number(row.stability),
				difficulty: row.difficulty === null ? null : Number(row.difficulty),
				lastReviewMs: row.last_review_ms === null ? null : Number(row.last_review_ms),
				reviews: Number(row.reviews ?? 0),
				dueAtMs: Number(row.due_at_ms),
				lane: String(row.lane) as FsrsCardRow["lane"],
				seedRating: Number(row.seed_rating) as FsrsCardRow["seedRating"],
				stage: String(row.stage) as FsrsCardRow["stage"],
			}));
		},

		getGraphRevision() {
			const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS rev FROM graph_events").get();
			return Number(row?.rev ?? 0);
		},

		saveJob(job) {
			db.prepare(
				`INSERT INTO jobs (id, kind, chat_id, tool_call_id, status, activity, created_at, updated_at, record_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
					kind = excluded.kind,
					chat_id = excluded.chat_id,
					tool_call_id = excluded.tool_call_id,
					status = excluded.status,
					activity = excluded.activity,
					created_at = excluded.created_at,
					updated_at = excluded.updated_at,
					record_json = excluded.record_json`,
			).run(
				job.id,
				job.kind,
				job.chatId,
				job.toolCallId,
				job.status,
				job.activity ?? "",
				job.createdAt,
				job.updatedAt,
				JSON.stringify(job),
			);
		},

		getJob(id) {
			const row = db.prepare("SELECT record_json FROM jobs WHERE id = ?").get(id);
			return row ? parseJson<JobRecord | null>(row.record_json, null) : null;
		},

		listJobs(chatId) {
			const rows = db
				.prepare("SELECT record_json FROM jobs WHERE chat_id = ? ORDER BY updated_at DESC")
				.all(chatId);
			return rows.map((r) => parseJson<JobRecord | null>(r.record_json, null)).filter((j): j is JobRecord => j !== null);
		},

		findJobByToolCallId(chatId, toolCallId) {
			const row = db
				.prepare("SELECT record_json FROM jobs WHERE chat_id = ? AND tool_call_id = ? LIMIT 1")
				.get(chatId, toolCallId);
			return row ? parseJson<JobRecord | null>(row.record_json, null) : null;
		},

		deleteJobsForChat(chatId) {
			return db.prepare("DELETE FROM jobs WHERE chat_id = ?").run(chatId).changes;
		},

		getKv(key) {
			const row = db.prepare("SELECT value_json FROM kv_documents WHERE key = ?").get(key);
			if (!row || typeof row.value_json !== "string") return null;
			return JSON.parse(row.value_json);
		},

		setKv(key, value) {
			db.prepare(
				`INSERT INTO kv_documents (key, value_json, updated_at) VALUES (?, ?, ?)
				 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
			).run(key, JSON.stringify(value), Date.now());
		},

		readIntervals() {
			const rows = db
				.prepare("SELECT chat_id, start_iso, end_iso, end_reason FROM study_intervals ORDER BY seq ASC")
				.all();
			return rows.map((row) => ({
				chatId: String(row.chat_id),
				start: String(row.start_iso),
				end: String(row.end_iso),
				endReason: String(row.end_reason),
			}));
		},

		appendIntervals(list) {
			const stmt = db.prepare(
				"INSERT INTO study_intervals (chat_id, start_iso, end_iso, end_reason) VALUES (?, ?, ?, ?)",
			);
			withTx(() => {
				for (const item of list) {
					stmt.run(item.chatId, item.start, item.end, item.endReason);
				}
			});
		},

		listPromptOverrides() {
			const rows = db.prepare("SELECT segment_path FROM prompt_overrides ORDER BY segment_path ASC").all();
			return rows.map((r) => String(r.segment_path));
		},

		readPromptOverride(segmentPath) {
			const row = db.prepare("SELECT content FROM prompt_overrides WHERE segment_path = ?").get(segmentPath);
			return row && typeof row.content === "string" ? row.content : null;
		},

		writePromptOverride(segmentPath, text) {
			db.prepare(
				`INSERT INTO prompt_overrides (segment_path, content) VALUES (?, ?)
				 ON CONFLICT(segment_path) DO UPDATE SET content = excluded.content`,
			).run(segmentPath, text);
		},

		deletePromptOverride(segmentPath) {
			db.prepare("DELETE FROM prompt_overrides WHERE segment_path = ?").run(segmentPath);
		},

		readAuthFile() {
			return authFile.read();
		},

		writeAuthFile(content) {
			authFile.write(content);
		},
	};

	return backend;
}

export function getSqliteBackend(): Promise<SqliteStoreBackend | null> {
	if (cachedPromise) return cachedPromise;
	cachedPromise = (async () => {
		if (
			typeof window !== "undefined" ||
			typeof process === "undefined" ||
			!process.versions?.node ||
			process.env.NODE_ENV === "test"
		) {
			return null;
		}
		try {
			const fs = await import(/* @vite-ignore */ "node:fs");
			const os = await import(/* @vite-ignore */ "node:os");
			const path = await import(/* @vite-ignore */ "node:path");
			const defaultMacDb = path.join(
				os.homedir(),
				"Library",
				"Application Support",
				"com.hwacha.learnharness",
				"learnharness.db",
			);
			const dbPath = process.env.LH_SQLITE_DB ? path.resolve(process.env.LH_SQLITE_DB) : defaultMacDb;
			if (!fs.existsSync(dbPath)) return null;
			const sqlite = await import(/* @vite-ignore */ "node:sqlite");
			const db = new sqlite.DatabaseSync(dbPath) as unknown as SqliteDb;
			db.exec("PRAGMA busy_timeout = 5000;");
			const authPath = path.join(path.dirname(dbPath), "auth.json");
			return buildBackend(db, {
				read: () => (fs.existsSync(authPath) ? fs.readFileSync(authPath, "utf8") : null),
				write: (content: string) => fs.writeFileSync(authPath, content, { encoding: "utf8", mode: 0o600 }),
			});
		} catch (err) {
			console.warn("SQLite dev backend unavailable, falling back to memory:", err);
			return null;
		}
	})();
	return cachedPromise;
}
