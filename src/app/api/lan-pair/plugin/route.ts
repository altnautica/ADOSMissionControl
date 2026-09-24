/**
 * @module LanPairPluginRoute
 * @description Same-origin, binary-safe proxy for the plugin routes an HTTPS
 * Mission Control needs on a plain-HTTP LAN node: an inline GCS module's
 * attestation, manifest and `gcs/` files, its per-node config, and the
 * plugin's own HTTP server behind the agent passthrough
 * (`/api/plugins/{id}/x/*`). The browser cannot reach the node itself from an
 * HTTPS page (mixed content), so the call is relayed server-side, exactly as
 * the other `/api/lan-pair/*` routes do.
 *
 * `<METHOD> ?host=<node>&path=/api/plugins/<id>/<sub>[&query=<qs>][&peer=<id>]`
 * with the pairing key in `X-ADOS-Key` (never in the URL). `sub` is one of
 * `attestation`, `manifest`, `config`, `gcs/<path>` or `x/<path>`; the method
 * must fit it. `peer` selects the relay lane: `host` is then the ground station
 * and the upstream is its relay-proxy route for that drone.
 *
 * Bodies pass through as bytes both ways. The upstream Content-Type is echoed
 * only from an inert allowlist; anything else (HTML, SVG, script) is served as
 * an opaque attachment under a sandbox CSP, so a node can never answer with a
 * document that runs on the Mission Control origin. WebSocket upgrades are not
 * proxied.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";
import {
  agentUrl,
  checkAgentHost,
  checkSameOrigin,
  isSafeSubPath,
  proxyError,
} from "../_proxy";
import { isValidPeerDeviceId } from "../_peer-device-id";

export const runtime = "nodejs";

/** A plugin passthrough call may be a long job read or a large asset. */
const UPSTREAM_TIMEOUT_MS = 120_000;
/** Largest request body relayed to the node. */
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
/** Longest query string relayed to the node. */
const MAX_QUERY_LENGTH = 2048;
/** The ground station's relay-proxy prefix (see `../config/route.ts`). */
const RELAY_PROXY_PREFIX = "/api/v1/ground-station/relay-proxy";

/** Response types echoed verbatim: data and media a page reads, none of which
 * a browser executes as a document or script. */
const INERT_CONTENT_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "application/wasm",
  "application/x-ndjson",
  "text/plain",
  "text/css",
  "text/csv",
  "text/yaml",
  "application/yaml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "font/woff",
  "font/woff2",
]);

const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "range",
  "if-none-match",
  "if-modified-since",
];
const FORWARDED_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
];

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Methods each plugin sub-route accepts. The passthrough takes any. */
function allowedMethods(sub: string): ReadonlySet<Method> {
  if (sub.startsWith("x/")) return new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  if (sub === "config") return new Set(["GET", "PUT"]);
  return new Set(["GET"]);
}

/** Refuse a request a cross-site page could have sent. The pairing key rides
 * a custom header, which no cross-site request carries without a CORS
 * preflight this route never answers; a present Origin or Fetch-Metadata
 * header must also name this origin. */
function checkCaller(req: NextRequest): NextResponse | null {
  if (req.headers.get("origin") !== null) {
    const cross = checkSameOrigin(req);
    if (cross) return cross.reject;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return proxyError(403, "cross_origin", "Request did not come from this site");
  }
  if (!req.headers.get("x-ados-key")?.trim()) {
    return proxyError(401, "key_required", "X-ADOS-Key is required");
  }
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return proxyError(400, "websocket_not_proxied", "WebSocket upgrades are not proxied");
  }
  return null;
}

/** Read the request body with a hard cap. */
async function readBody(req: NextRequest): Promise<Uint8Array | NextResponse> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return proxyError(413, "body_too_large", "The request body is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function handle(req: NextRequest, method: Method): Promise<NextResponse> {
  const refused = checkCaller(req);
  if (refused) return refused;

  const q = req.nextUrl.searchParams;
  const checked = checkAgentHost(q.get("host") ?? "");
  if ("reject" in checked) return checked.reject;

  // `/api/plugins/<id>/<sub>`: plain segments only, and a sub-route this proxy
  // serves. The id and path are the caller's; the route shape is fixed here.
  const path = q.get("path") ?? "";
  const match = /^\/api\/plugins\/([^/]+)\/(.+)$/.exec(path);
  const sub = match?.[2] ?? "";
  const subOk =
    sub === "attestation" ||
    sub === "manifest" ||
    sub === "config" ||
    /^(gcs|x)\/.+/.test(sub);
  if (!match || !subOk || !isSafeSubPath(path.slice(1))) {
    return proxyError(400, "bad_path", "path must be a plugin attestation, manifest, config, gcs or x route");
  }
  if (!allowedMethods(sub).has(method)) {
    return proxyError(405, "method_not_allowed", `${method} is not allowed on ${sub.split("/")[0]}`);
  }

  const rawQuery = q.get("query") ?? "";
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return proxyError(414, "query_too_long", "The query string is too long");
  }
  // Re-serialised so nothing in it can act as a fragment or a path.
  const query = new URLSearchParams(rawQuery).toString();

  const peer = q.get("peer");
  if (peer !== null && !isValidPeerDeviceId(peer)) {
    return proxyError(400, "bad_peer_device_id", "peer must be a device id");
  }
  const upstreamPath = `${peer !== null ? `${RELAY_PROXY_PREFIX}/${peer}` : ""}${path}`;

  const body = method === "GET" ? undefined : await readBody(req);
  if (body instanceof NextResponse) return body;

  const headers = new Headers();
  for (const h of FORWARDED_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("X-ADOS-Key", req.headers.get("x-ados-key")?.trim() ?? "");

  try {
    const url = await agentUrl(checked.target, query ? `${upstreamPath}?${query}` : upstreamPath);
    if (typeof url !== "string") return url.reject;
    const upstream = await fetch(url, {
      method,
      headers,
      body: body && body.byteLength > 0 ? Buffer.from(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
      await upstream.body?.cancel();
      return proxyError(502, "upstream_redirect", "The node answered with a redirect");
    }

    const out = new Headers();
    for (const h of FORWARDED_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    const type = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (INERT_CONTENT_TYPES.has(type)) {
      out.set("content-type", upstream.headers.get("content-type") ?? type);
    } else {
      out.set("content-type", "application/octet-stream");
      out.set("content-disposition", "attachment");
    }
    out.set("x-content-type-options", "nosniff");
    out.set("content-security-policy", "sandbox");
    const noBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
    return new NextResponse(noBody ? null : upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    return proxyError(502, "upstream_unreachable", e instanceof Error ? e.message : String(e));
  }
}

export const GET = (req: NextRequest) => handle(req, "GET");
export const POST = (req: NextRequest) => handle(req, "POST");
export const PUT = (req: NextRequest) => handle(req, "PUT");
export const PATCH = (req: NextRequest) => handle(req, "PATCH");
export const DELETE = (req: NextRequest) => handle(req, "DELETE");
