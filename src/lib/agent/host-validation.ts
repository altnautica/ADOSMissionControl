/**
 * @module HostValidation
 * @description Shared SSRF guard for the LAN-pair proxy. Validates
 * that a host string the operator typed (or a URL the browser
 * forwarded) points at a private / mDNS / loopback address before
 * Mission Control's Next.js server makes any plain-HTTP request on
 * the operator's behalf.
 *
 * Used by both the server-side `/api/lan-pair/*` route handlers and
 * the browser-side `local-pair-client.ts` so the GCS surfaces a
 * typed rejection before round-tripping the server, and so the
 * proxy can't be used as an open scanner if a request bypasses the
 * client check.
 *
 * Pure function: no Node, no DOM, no react. Importable from both
 * runtimes.
 *
 * @license GPL-3.0-only
 */

const PRIVATE_V4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./, // link-local
];

/**
 * Parse an IPv6 literal into its eight 16-bit groups, or null when the string
 * is not a syntactically valid IPv6 address. Handles `::` zero-compression, an
 * embedded trailing IPv4 (`::ffff:192.0.2.1`), and a `%zone` suffix. Pure (no
 * `node:net`) so it stays importable from the browser bundle.
 */
function parseIpv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone); // drop a zone id
  if (!s) return null;

  // Fold a trailing embedded IPv4 (::ffff:192.0.2.1) down to two hex groups.
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    s =
      s.slice(0, v4.index) +
      (((o[0] << 8) | o[1]) >>> 0).toString(16) +
      ":" +
      (((o[2] << 8) | o[3]) >>> 0).toString(16);
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const halves = s.split("::");
  if (halves.length > 2) return null; // "::" may appear at most once

  if (halves.length === 2) {
    const head = parseGroups(halves[0]);
    const tail = parseGroups(halves[1]);
    if (head === null || tail === null) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // "::" must stand for at least one zero group
    return [...head, ...Array<number>(fill).fill(0), ...tail];
  }

  const groups = parseGroups(s);
  return groups && groups.length === 8 ? groups : null;
}

/** True when a parsed IPv6 literal is in fc00::/7 (ULA) or fe80::/10
 * (link-local) — the only IPv6 ranges Mission Control is willing to proxy to. */
function isPrivateV6Range(literal: string): boolean {
  const h = parseIpv6(literal);
  if (!h) return false;
  const first = h[0];
  return (
    (first >= 0xfc00 && first <= 0xfdff) || // fc00::/7
    (first >= 0xfe80 && first <= 0xfebf) // fe80::/10
  );
}

/** True when a parsed IPv6 literal is the loopback address `::1`. */
function isLoopbackV6(literal: string): boolean {
  const h = parseIpv6(literal);
  return h !== null && h.every((g, i) => g === (i === 7 ? 1 : 0));
}

/** Return the de-bracketed IPv6 literal when `host` is one, else null.
 * `URL.hostname` wraps IPv6 literals in `[...]`; a bare hostname or IPv4 never
 * contains a colon, so a colon after de-bracketing marks an IPv6 literal. */
function ipv6Literal(host: string): string | null {
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);
  return host.includes(":") ? host : null;
}

export type HostValidationResult =
  | { url: string; host: string; port: number; error?: never; message?: never }
  | { error: string; message: string; url?: never; host?: never; port?: never };

/**
 * Normalise a user-pasted host string and confirm it points at a
 * private address Mission Control is willing to proxy to.
 *
 * Accepts bare hostnames (`groundnode.local`, `192.168.1.50`), full
 * URLs (`http://192.168.1.50:8080`), and trailing slashes. Defaults
 * the port to 8080 when an http:// URL omits it (matches the agent's
 * default REST port). Rejects userinfo, non-http(s) schemes, and
 * public hostnames.
 */
export function normaliseAndCheckHost(input: string): HostValidationResult {
  let s = (input ?? "").trim();
  if (!s) {
    return { error: "host_required", message: "host is required" };
  }
  // An operator may paste a bare IPv6 literal (2+ colons, unbracketed). Wrap it
  // in brackets before URL parsing, which otherwise rejects it. A `host:port`
  // pair has a single colon and is left untouched.
  if (
    !/^https?:\/\//i.test(s) &&
    !s.startsWith("[") &&
    !s.includes("/") &&
    (s.match(/:/g) || []).length >= 2
  ) {
    s = `[${s}]`;
  }
  if (!/^https?:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "bad_host", message: "Could not parse host as URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return {
      error: "bad_scheme",
      message: "Only http and https are supported",
    };
  }
  if (u.username || u.password) {
    return {
      error: "userinfo_not_allowed",
      message: "URL must not include user:password",
    };
  }
  if (!u.port && u.protocol === "http:") {
    u.port = "8080";
  }
  // Strip path / query / fragment — the proxy will compose its own
  // upstream path.
  u.pathname = "";
  u.search = "";
  u.hash = "";

  const host = u.hostname.toLowerCase();
  // A colon (after de-bracketing) marks an IPv6 literal; a DNS name / IPv4 has
  // none. Routing every IPv6 decision through the parsed address means a public
  // DNS name that merely *starts* with the ULA hex (e.g. `fd-cdn.example.com`)
  // is never mistaken for a private address.
  const v6 = ipv6Literal(host);
  const isMdns = v6 === null && host.endsWith(".local");
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    (v6 !== null && isLoopbackV6(v6));
  const isPrivateV4 = v6 === null && PRIVATE_V4.some((re) => re.test(host));
  // fc00::/7 (ULA) and fe80::/10 (link-local) are the only IPv6 ranges Mission
  // Control accepts, checked against the PARSED address, never a leading
  // substring.
  const isPrivateV6 = v6 !== null && isPrivateV6Range(v6);

  if (!isMdns && !isLoopback && !isPrivateV4 && !isPrivateV6) {
    return {
      error: "host_not_private",
      message:
        "Only RFC1918, mDNS .local, or loopback hosts are allowed",
    };
  }

  const normalized = u.toString().replace(/\/+$/, "");
  return {
    url: normalized,
    host,
    port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
  };
}
