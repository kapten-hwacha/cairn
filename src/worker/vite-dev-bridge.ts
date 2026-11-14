import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { realSourcePath, resolvePolicy } from "../agent/tools/file-access.ts";
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";
import { isAllowedLocalHost } from "../server/desktop-access.ts";
import { fileAccessPolicy } from "../server/file-access.ts";

const MAX_DEV_BODY_BYTES = 10 * 1024 * 1024;
const MAX_DEV_FETCH_RESPONSE_BYTES = 55 * 1024 * 1024;

export function isAuthorizedDevBridgeRequest(req: IncomingMessage): boolean {
	if (req.headers["x-lh-dev-bridge"] !== "1") {
		return false;
	}
	const remoteAddress = req.socket?.remoteAddress;
	if (typeof remoteAddress === "string" && remoteAddress.length > 0 && !process.env.TAURI_DEV_HOST) {
		if (
			remoteAddress !== "127.0.0.1" &&
			remoteAddress !== "::1" &&
			remoteAddress !== "::ffff:127.0.0.1"
		) {
			return false;
		}
	}
	const secFetchSite = req.headers["sec-fetch-site"];
	if (typeof secFetchSite === "string") {
		if (secFetchSite !== "same-origin" && secFetchSite !== "none") {
			return false;
		}
	}
	const host = req.headers["host"];
	if (typeof host === "string" && !isAllowedLocalHost(host)) {
		return false;
	}
	const origin = req.headers["origin"];
	if (typeof origin === "string") {
		if (origin === "null" || typeof host !== "string") {
			return false;
		}
		try {
			const parsed = new URL(origin);
			if (parsed.host !== host) {
				return false;
			}
		} catch {
			return false;
		}
	}
	if (req.method === "POST") {
		const contentType = req.headers["content-type"];
		if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
			return false;
		}
	}
	return true;
}

export function assertSafeDevFetchUrl(targetUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		throw new Error("Invalid URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Forbidden protocol: ${parsed.protocol}`);
	}
	if (parsed.username !== "" || parsed.password !== "") {
		throw new Error("URLs with credentials are not allowed");
	}
	const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if (
		hostname === "169.254.169.254" ||
		hostname === "metadata.google.internal" ||
		hostname === "0.0.0.0" ||
		hostname.startsWith("169.254.") ||
		hostname === "[::]" ||
		hostname.startsWith("[fe80:") ||
		hostname === "[fd00:ec2::254]" ||
		hostname.startsWith("[::ffff:169.254.") ||
		hostname.startsWith("[::ffff:a9fe:") ||
		hostname === "[::ffff:0.0.0.0]" ||
		hostname === "[::ffff:0:0]" ||
		hostname.startsWith("[64:ff9b:") ||
		hostname === "nip.io" ||
		hostname.endsWith(".nip.io") ||
		hostname === "sslip.io" ||
		hostname.endsWith(".sslip.io") ||
		hostname === "xip.io" ||
		hostname.endsWith(".xip.io")
	) {
		throw new Error(`Forbidden host: ${hostname}`);
	}
	return parsed;
}

export function isAllowedSyncPath(targetPath: string, dataDir: string, authFile: string): boolean {
	if (!targetPath || !targetPath.startsWith("/")) return false;
	const normTarget = path.posix.normalize(targetPath);
	const normDataDir = path.posix.normalize(dataDir);
	const normAuth = path.posix.normalize(authFile);

	const dataDirPrefix = normDataDir.endsWith("/") ? normDataDir : normDataDir + "/";
	const lexicalAllowed = normTarget === normAuth || normTarget === normDataDir || normTarget.startsWith(dataDirPrefix);
	if (!lexicalAllowed) return false;

	if (fs.existsSync(dataDir) || fs.existsSync(path.dirname(authFile))) {
		try {
			const realTarget = realSourcePath(targetPath);
			const realDataDir = realSourcePath(dataDir);
			const realAuthFile = realSourcePath(authFile);
			const dataDirRealPrefix = realDataDir.endsWith(path.sep) ? realDataDir : realDataDir + path.sep;
			return realTarget === realAuthFile || realTarget === realDataDir || realTarget.startsWith(dataDirRealPrefix);
		} catch {
			return false;
		}
	}

	return true;
}

function readBody(req: IncomingMessage, maxBytes = MAX_DEV_BODY_BYTES): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer | string) => {
			const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			total += buf.length;
			if (total > maxBytes) {
				req.destroy();
				reject(new Error(`Request body too large (> ${maxBytes} bytes)`));
				return;
			}
			chunks.push(buf);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

export function lhViteDevBridgePlugin(): Plugin {
	return {
		name: "lh-vite-dev-bridge",
		configureServer(server) {
			server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
				const url = req.url?.split("?")[0];

				if (url?.startsWith("/__lh_dev/")) {
					if (!isAuthorizedDevBridgeRequest(req)) {
						res.statusCode = 403;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ error: "Forbidden dev bridge request" }));
						return;
					}
				}

				if (url === "/__lh_dev/fs-read-external" && req.method === "POST") {
					try {
						const bodyStr = await readBody(req);
						const { path: filePath } = JSON.parse(bodyStr) as { path: string };
						let resolved: string;
						try {
							resolved = resolveSourcePath(filePath, resolvePolicy(fileAccessPolicy()));
							if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
								res.statusCode = 403;
								res.setHeader("Content-Type", "application/json");
								res.end(JSON.stringify({ error: `Path is not a valid file: ${filePath}` }));
								return;
							}
						} catch (valErr) {
							res.statusCode = 403;
							res.setHeader("Content-Type", "application/json");
							res.end(JSON.stringify({ error: String(valErr) }));
							return;
						}

						const data = fs.readFileSync(resolved);
						res.setHeader("Content-Type", "application/octet-stream");
						res.statusCode = 200;
						res.end(data);
					} catch (err) {
						res.statusCode = 500;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ error: String(err) }));
					}
					return;
				}

				if (url === "/__lh_dev/fetch" && req.method === "POST") {
					try {
						const bodyStr = await readBody(req);
						const { url: targetUrl, method, headers, body, redirect } = JSON.parse(bodyStr) as {
							url: string;
							method?: string;
							headers?: Record<string, string>;
							body?: string;
							redirect?: RequestRedirect;
						};

						let currentUrl: string;
						try {
							currentUrl = assertSafeDevFetchUrl(targetUrl).toString();
						} catch (urlErr) {
							const msg = urlErr instanceof Error ? urlErr.message : String(urlErr);
							res.statusCode = msg === "Invalid URL" ? 400 : 403;
							res.setHeader("Content-Type", "application/json");
							res.end(JSON.stringify({ error: msg }));
							return;
						}

						let response: Response;
						let hops = 0;
						const redirectMode = redirect ?? "follow";
						while (true) {
							response = await fetch(currentUrl, {
								method: method || "GET",
								headers,
								body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
								redirect: "manual",
							});
							if (
								redirectMode === "follow" &&
								response.status >= 300 &&
								response.status < 400
							) {
								const location = response.headers.get("location");
								if (!location) break;
								hops++;
								if (hops > 10) {
									res.statusCode = 502;
									res.end("Too many redirects");
									return;
								}
								try {
									const nextUrl = new URL(location, currentUrl).toString();
									currentUrl = assertSafeDevFetchUrl(nextUrl).toString();
								} catch (redirectErr) {
									res.statusCode = 403;
									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify({ error: String(redirectErr) }));
									return;
								}
								continue;
							}
							break;
						}

						res.statusCode = response.status;
						response.headers.forEach((value, key) => {
							res.setHeader(key, value);
						});
						res.setHeader("x-lh-dev-proxied", "1");

						if (response.body) {
							const reader = response.body.getReader();
							let totalWritten = 0;
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								totalWritten += value.byteLength;
								if (totalWritten > MAX_DEV_FETCH_RESPONSE_BYTES) {
									await reader.cancel();
									res.destroy();
									return;
								}
								res.write(value);
							}
							res.end();
						} else {
							res.end();
						}
					} catch (err) {
						res.statusCode = 502;
						res.end(String(err));
					}
					return;
				}

				next();
			});
		},
	};
}

export const viteDevBridge = lhViteDevBridgePlugin;
