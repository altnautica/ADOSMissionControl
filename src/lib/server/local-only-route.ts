/**
 * @module server/local-only-route
 * @description The caller gate for Mission Control's server routes that act on
 * the operator's own network or machine: the `/api/lan-pair/*` proxy (which
 * talks to agents on the server's LAN, including unpaired ones that accept a
 * claim from any local caller) and the MCP activity feed (which streams every
 * tool call the local MCP server handled).
 *
 * A route handler cannot see the socket's peer address. Next fills
 * `x-forwarded-for` from the socket only when the client sent none, so a
 * caller can always put its own value there. The gate therefore rests on what
 * a browser cannot forge and a deployment controls:
 *
 *  1. **Host.** The `Host` header (and every `X-Forwarded-Host` hop) must name
 *     this machine or its network: a loopback name or literal, a private /
 *     link-local / ULA IP literal, a `*.local` mDNS name, or a host the
 *     operator listed in `ADOS_LOCAL_ROUTE_HOSTS` (comma-separated). A page
 *     served under a public name, and a DNS-rebinding page (whose Host is the
 *     attacker's name), are refused.
 *  2. **Forwarded peers.** Every `X-Forwarded-For` hop, when present, must be a
 *     loopback or private address, so a reverse proxy relaying an internet
 *     client is refused.
 *  3. **Switch.** `ADOS_LOCAL_ROUTES=off` refuses every call. A deployment
 *     reached by a public name sets it.
 *
 * A route that must only ever serve this same machine passes
 * `{ loopback: true }`: the Host must then be a loopback name, and every
 * forwarded hop (at least one) must be loopback.
 *
 * Refusals are 403 `{ "error": "local_only" }`.
 *
 * @license GPL-3.0-only
 */

import { NextResponse } from "next/server";
import { isLoopbackIp, isPrivateIp } from "@/lib/agent/host-validation";
import { PROXY_ERROR_HEADER } from "@/lib/agent/local-pair/transport";

export interface LocalOnlyOptions {
  /** Serve only a caller on this same machine. */
  loopback?: boolean;
}

/** The hostname inside a `Host`-style value (`name`, `name:port`,
 * `[v6]:port`), lowercased with any trailing dot removed, or null when the
 * value is not a bare authority. */
function authorityHostname(value: string): string | null {
  const raw = value.trim();
  if (!raw || /[/?#@\s]/.test(raw)) return null;
  try {
    const host = new URL(`http://${raw}`).hostname.toLowerCase();
    return host.replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/** One `X-Forwarded-For` hop as a bare address: brackets and a trailing port
 * removed (`[::1]:5000` → `::1`, `192.168.1.50:5000` → `192.168.1.50`). */
function forwardedAddress(hop: string): string {
  const s = hop.trim();
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const v4WithPort = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return v4WithPort ? v4WithPort[1] : s;
}

/** Hosts the operator added through `ADOS_LOCAL_ROUTE_HOSTS`. */
function operatorHosts(): Set<string> {
  const out = new Set<string>();
  for (const entry of (process.env.ADOS_LOCAL_ROUTE_HOSTS ?? "").split(",")) {
    const host = authorityHostname(entry);
    if (host) out.add(host);
  }
  return out;
}

function refuse(message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: "local_only", message }), {
    status: 403,
    headers: {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      [PROXY_ERROR_HEADER]: "local_only",
    },
  });
}

/**
 * Refuse a request that did not come from this machine or its local network.
 * Returns the 403 response to send, or null when the caller may proceed.
 */
export function checkLocalOnlyRoute(
  req: Request,
  opts: LocalOnlyOptions = {},
): NextResponse | null {
  if ((process.env.ADOS_LOCAL_ROUTES ?? "").trim().toLowerCase() === "off") {
    return refuse("Local network routes are turned off on this deployment");
  }

  const hostValues = [
    // The request URL carries the addressed host when no Host header does.
    req.headers.get("host") ?? new URL(req.url).host,
    ...(req.headers.get("x-forwarded-host") ?? "")
      .split(",")
      .filter((h) => h.trim() !== ""),
  ];
  const allowed = operatorHosts();
  for (const value of hostValues) {
    const host = authorityHostname(value);
    const loopback = host === "localhost" || (host !== null && isLoopbackIp(host));
    const local =
      loopback ||
      (host !== null &&
        (isPrivateIp(host) ||
          (host.endsWith(".local") && !host.includes(":")) ||
          allowed.has(host)));
    if (!(opts.loopback ? loopback : local)) {
      return refuse("This route only serves pages opened on the local network");
    }
  }

  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(forwardedAddress)
    .filter((h) => h !== "");
  if (opts.loopback && hops.length === 0) {
    return refuse("This route only serves this machine");
  }
  const peerOk = opts.loopback ? isLoopbackIp : isPrivateIp;
  if (!hops.every(peerOk)) {
    return refuse("This route only serves callers on the local network");
  }
  return null;
}
