/**
 * @module LanPairUnpairRoute
 * @description Server-side proxy for the LAN agent's
 * `/api/pairing/unpair` endpoint.
 *
 * The browser POSTs `{ host, apiKey }`. Server forwards the API key
 * in the `X-ADOS-Key` header the agent's auth middleware reads. A JSON
 * body and status are returned unchanged (see `../_proxy`). The API key stays under browser
 * control — it
 * never lands in cookies or Mission Control's database; it just
 * relays through the server in one request.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import {
  checkAgentHost,
  proxyError,
  proxyToAgent,
  readJsonEnvelope,
} from "../_proxy";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  const apiKey = String(env.payload.apiKey ?? "").trim();
  if (!apiKey) {
    return proxyError(400, "api_key_required", "apiKey is required");
  }

  // Resolved to IPv4 first so a .local host doesn't stall on AAAA (../_ipv4).
  return proxyToAgent({
    target: host.target,
    path: "/api/pairing/unpair",
    method: "POST",
    apiKey,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
