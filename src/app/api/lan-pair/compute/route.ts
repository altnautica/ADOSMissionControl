/**
 * @module LanPairComputeRoute
 * @description Server-side proxy for a compute node's job API
 * (`/api/compute/*` on the engine's own `:8092` listener). Sibling to the
 * pairing / vision-detector proxy routes (local-first): lets an HTTPS
 * Mission Control reach a plain-HTTP LAN compute node without tripping the
 * browser's mixed-content guard, and resolves `*.local` server-side.
 *
 * The browser POSTs `{ host, apiKey, path, method, body }`. The server forces
 * the engine job port (`:8092`), resolves the host to IPv4 (dodging the AAAA
 * stall on a `.local` box with no IPv6), forwards the request with the
 * `X-ADOS-Key` header, and relays the status + JSON body unchanged (see
 * `../_proxy`) so the client coerces the engine's response with no extra
 * translation. `path` is checked segment by segment and can only name
 * something under `/api/compute/`.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import {
  checkAgentHost,
  isSafeSubPath,
  proxyError,
  proxyToAgent,
  readJsonEnvelope,
} from "../_proxy";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 12000;
/** The ados-compute engine's own job-API port. */
const COMPUTE_JOB_PORT = 8092;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const { payload } = env;
  const host = checkAgentHost(payload.host);
  if ("reject" in host) return host.reject;

  // Sub-path under /api/compute/: plain segments only (no %, dot or empty
  // segment), so it can never leave that prefix.
  if (!isSafeSubPath(payload.path)) {
    return proxyError(
      400,
      "bad_path",
      "path must be plain segments under /api/compute/",
    );
  }

  const method = String(payload.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return proxyError(400, "bad_method", "Only GET and POST are supported");
  }

  const hasBody =
    method === "POST" && payload.body !== undefined && payload.body !== null;

  // Force the engine job port (:8092); the host resolves to IPv4 first so a
  // .local host doesn't burn ~5 s on the AAAA lookup (../_ipv4).
  return proxyToAgent({
    target: host.target,
    port: COMPUTE_JOB_PORT,
    path: `/api/compute/${payload.path}`,
    method,
    apiKey: String(payload.apiKey ?? "").trim(),
    json: hasBody ? payload.body : undefined,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
