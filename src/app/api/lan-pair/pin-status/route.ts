/**
 * @module LanPairPinStatusRoute
 * @description Server-side proxy for the LAN agent's
 * `/api/dashboard/pin/status` endpoint (the dashboard-access PIN posture).
 *
 * The browser POSTs `{ host, apiKey }`. The server GETs the agent's public
 * status route, forwarding the API key in `X-ADOS-Key` (harmless — the status
 * route is public, but the uniform shape keeps the proxy simple). A JSON body + status
 * are returned unchanged (see `../_proxy`). The key stays under browser control; it just relays
 * through the server in one request.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import { checkAgentHost, proxyToAgent, readJsonEnvelope } from "../_proxy";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  return proxyToAgent({
    target: host.target,
    path: "/api/dashboard/pin/status",
    method: "GET",
    apiKey: String(env.payload.apiKey ?? "").trim(),
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
