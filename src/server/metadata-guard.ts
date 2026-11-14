/**
 * SSRF guard for local-capable endpoints (Custom Provider & Quaderno):
 * blocks cloud metadata endpoints and link-local addresses while preserving
 * localhost, loopback (127.0.0.1, ::1), and LAN RFC1918 addresses.
 */

function isBlockedIpv4Tuple(a: number, b: number, c: number, d: number): boolean {
	if (a === 0) return true; // 0.0.0.0/8 (includes 0.0.0.0)
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
	if (a === 100 && b === 100 && c === 100 && d === 200) return true; // Alibaba Cloud metadata
	return false;
}

function parseIpv4Quad(host: string): [number, number, number, number] | null {
	const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return null;
	const a = Number(m[1]);
	const b = Number(m[2]);
	const c = Number(m[3]);
	const d = Number(m[4]);
	if (
		a < 0 || a > 255 ||
		b < 0 || b > 255 ||
		c < 0 || c > 255 ||
		d < 0 || d > 255
	) {
		return null;
	}
	return [a, b, c, d];
}

function parseIpv6Hextets(addr: string): number[] | null {
	let input = addr;
	const lastColon = input.lastIndexOf(":");
	if (lastColon !== -1 && input.slice(lastColon + 1).includes(".")) {
		const ipv4 = parseIpv4Quad(input.slice(lastColon + 1));
		if (!ipv4) return null;
		const hi = ((ipv4[0] << 8) | ipv4[1]).toString(16);
		const lo = ((ipv4[2] << 8) | ipv4[3]).toString(16);
		input = `${input.slice(0, lastColon + 1)}${hi}:${lo}`;
	}

	const doubleColonParts = input.split("::");
	if (doubleColonParts.length > 2) return null;

	const parseSide = (side: string): number[] | null => {
		if (!side) return [];
		const parts = side.split(":");
		const out: number[] = [];
		for (const part of parts) {
			if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
			out.push(parseInt(part, 16));
		}
		return out;
	};

	if (doubleColonParts.length === 1) {
		const groups = parseSide(doubleColonParts[0]!);
		return groups && groups.length === 8 ? groups : null;
	}

	const left = parseSide(doubleColonParts[0]!);
	const right = parseSide(doubleColonParts[1]!);
	if (!left || !right || left.length + right.length >= 8) return null;
	const zeros = new Array<number>(8 - left.length - right.length).fill(0);
	return [...left, ...zeros, ...right];
}

export function isBlockedMetadataOrLinkLocalHost(hostname: string): boolean {
	let host = hostname.trim().toLowerCase();
	while (host.endsWith(".")) {
		host = host.slice(0, -1);
	}
	if (host.startsWith("[") && host.endsWith("]")) {
		host = host.slice(1, -1).trim();
	}
	const zoneIndex = host.indexOf("%");
	if (zoneIndex !== -1) {
		host = host.slice(0, zoneIndex);
	}
	while (host.endsWith(".")) {
		host = host.slice(0, -1);
	}
	if (!host) return true;

	if (
		host === "0.0.0.0" ||
		host === "metadata" ||
		host === "metadata.google.internal" ||
		host.endsWith(".metadata.google.internal") ||
		host === "100.100.100.200"
	) {
		return true;
	}

	if (!host.includes(":")) {
		try {
			const parsed = new URL(`http://${host}`);
			if (parsed.hostname && parsed.hostname !== host) {
				return isBlockedMetadataOrLinkLocalHost(parsed.hostname);
			}
		} catch {
			// ignore unparseable host
		}

		const ipv4 = parseIpv4Quad(host);
		if (ipv4) {
			return isBlockedIpv4Tuple(ipv4[0], ipv4[1], ipv4[2], ipv4[3]);
		}
		return false;
	}

	const hextets = parseIpv6Hextets(host);
	if (!hextets) {
		// Unparseable IPv6 literal: fail closed for literal prefixes
		return (
			host.startsWith("fe8") ||
			host.startsWith("fe9") ||
			host.startsWith("fea") ||
			host.startsWith("feb") ||
			host.startsWith("64:ff9b:") ||
			host === "::"
		);
	}

	const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	];

	// :: (unspecified)
	if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 === 0) {
		return true;
	}

	// fe80::/10 link-local
	if ((h0 & 0xffc0) === 0xfe80) {
		return true;
	}

	// fd00:ec2::254 AWS EC2 IPv6 metadata
	if (
		h0 === 0xfd00 &&
		h1 === 0x0ec2 &&
		h2 === 0 &&
		h3 === 0 &&
		h4 === 0 &&
		h5 === 0 &&
		h6 === 0 &&
		h7 === 0x0254
	) {
		return true;
	}

	// 64:ff9b::* NAT64
	if (h0 === 0x0064 && h1 === 0xff9b) {
		return true;
	}

	// ::ffff:0:0/96 IPv4-mapped IPv6
	if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
		return isBlockedIpv4Tuple((h6 >> 8) & 0xff, h6 & 0xff, (h7 >> 8) & 0xff, h7 & 0xff);
	}

	// ::/96 IPv4-compatible IPv6 (excluding ::1 loopback)
	if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && !(h6 === 0 && h7 === 1)) {
		return isBlockedIpv4Tuple((h6 >> 8) & 0xff, h6 & 0xff, (h7 >> 8) & 0xff, h7 & 0xff);
	}

	return false;
}
