import { timingSafeEqual } from "node:crypto";

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Validates that a Host header belongs to a trusted local/LAN address or `LH_ALLOWED_HOSTS`. */
export function isAllowedLocalHost(
	hostHeader: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const trimmed = hostHeader.trim().toLowerCase();
	if (!trimmed) return false;
	let hostname: string;
	try {
		hostname = new URL(`http://${trimmed}`).hostname.toLowerCase();
	} catch {
		return false;
	}

	if (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "[::1]" ||
		hostname === "::1" ||
		hostname === "tauri.localhost"
	) {
		return true;
	}

	const ipv4Match = IPV4_RE.exec(hostname);
	if (ipv4Match) {
		const a = Number(ipv4Match[1]);
		const b = Number(ipv4Match[2]);
		const c = Number(ipv4Match[3]);
		const d = Number(ipv4Match[4]);
		if (
			[a, b, c, d].every((n) => n >= 0 && n <= 255) &&
			(a === 127 ||
				a === 10 ||
				(a === 192 && b === 168) ||
				(a === 172 && b >= 16 && b <= 31))
		) {
			return true;
		}
	}

	const rawAllowed = env.LH_ALLOWED_HOSTS;
	if (rawAllowed) {
		const allowed = rawAllowed
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
		if (allowed.includes(hostname) || allowed.includes(trimmed)) {
			return true;
		}
	}

	return false;
}

/** Same-origin and CSRF guard. Returns false for cross-site browser requests or DNS rebinding hosts. */
export function sameOriginAuthorized(
	headers: Pick<Headers, "get">,
	url?: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const origin = headers.get("origin");
	if (
		env.NODE_ENV !== "production" &&
		origin !== null &&
		(origin === "tauri://localhost" ||
			origin === "http://tauri.localhost" ||
			origin === "https://tauri.localhost")
	) {
		return true;
	}

	const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
	if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
		return false;
	}

	const expectedHost =
		headers.get("host") ??
		(url
			? (() => {
					try {
						return new URL(url).host;
					} catch {
						return null;
					}
			  })()
			: null);

	if (expectedHost !== null && !isAllowedLocalHost(expectedHost, env)) {
		return false;
	}

	if (origin !== null) {
		if (origin === "null") return false;
		let parsedOrigin: URL;
		try {
			parsedOrigin = new URL(origin);
		} catch {
			return false;
		}

		if (!expectedHost || parsedOrigin.host !== expectedHost) {
			return false;
		}
	}

	return true;
}

/** Per-launch desktop HTTP capability. This is not an OS-user malware
 * boundary and is not an OAuth credential. Browser-only mode is unchanged. */
export function desktopAPIAuthorized(
	headers: Pick<Headers, "get">,
	env: Record<string, string | undefined> = process.env,
	url?: string,
): boolean {
	const expected = env.LH_DESKTOP_API_SECRET;
	if (env.LH_DESKTOP_SERVER !== "1" && !expected) {
		return sameOriginAuthorized(headers, url, env);
	}
	if (!expected || expected.length < 64) return false;
	const supplied = headers.get("x-learnharness-desktop");
	if (!supplied) return false;
	const actual = Buffer.from(supplied);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
