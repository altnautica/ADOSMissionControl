/**
 * @module agent/local-pair/transport
 * @description Shared transport internals for the local-first pair
 * flow: host normalisation, the proxy-vs-direct decision, the pair-call
 * deadline, and the JSON-safe response reader. These are the
 * primitives the probe / claim / unpair helpers build on.
 *
 * The three pair-flow calls route through Mission Control's own Next.js
 * server (`/api/lan-pair/*`) whenever a window exists. The server-side
 * proxy performs the HTTP request to the agent and enforces the same
 * private-address whitelist via `host-validation.ts`. Going through the
 * proxy uniformly fixes two browser gaps in one shot:
 *
 * 1. HTTPS mixed-content (browser blocks `fetch(http://...)` from
 *    `https://command.altnautica.com`).
 * 2. mDNS resolution (Safari, Firefox-without-permission, Brave's
 *    strict privacy mode, and any browser with link-local DNS disabled
 *    cannot resolve `*.local` from the renderer; the Node-side
 *    `getaddrinfo` uses the OS resolver which DOES speak mDNS).
 *
 * Pair is a one-off operation, so the extra hop is irrelevant to
 * user-perceived latency.
 *
 * @license GPL-3.0-only
 */

/** Strip trailing slashes and normalise a user-pasted host string.
 * Bare hostnames default to ``http://<host>:8080``. https URLs are
 * left untouched (TLS endpoints terminate on their own port).
 */
export function normaliseHost(input: string): string {
  let s = input.trim();
  if (!s) return s;
  // Bare hostname → assume http://<host>:8080.
  if (!/^https?:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  // Append :8080 only for http URLs without an explicit port. Leave
  // https alone — TLS endpoints set their own port and 8080 would be
  // wrong 99% of the time.
  try {
    const u = new URL(s);
    if (!u.port && u.protocol === "http:") {
      u.port = "8080";
    }
    // Drop trailing slash from pathname.
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/+$/, "");
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/** The deadline each `/api/lan-pair/*` route gives its upstream agent call. */
export const LAN_PAIR_UPSTREAM_TIMEOUT_MS = 8000;

/** The browser's deadline for a pair call: the routes' upstream deadline plus
 * a margin for the proxy hop, so on the proxy path the route answers with
 * its own unreachable reply before the browser gives up on it. */
export const FETCH_TIMEOUT_MS = LAN_PAIR_UPSTREAM_TIMEOUT_MS + 2000;

/** True when a window exists, so the calls should be routed through the
 * Mission Control proxy rather than a direct cross-origin fetch. */
export function shouldUseProxy(): boolean {
  return typeof window !== "undefined";
}

export async function safeJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}
