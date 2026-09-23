/**
 * @module LanPairPinSetRoute
 * @description Server-side proxy for the LAN agent's `/api/dashboard/pin/set`
 * endpoint (set/replace the dashboard-access PIN).
 *
 * The browser POSTs `{ host, apiKey, pin }`. The server forwards the API key in
 * `X-ADOS-Key` (which authorizes the change on the agent) and the `{ pin }` body.
 * A JSON body + status are returned unchanged (see `../_proxy`). The key stays under browser control; it
 * just relays through the server in one request.
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
  const pin = String(env.payload.pin ?? "");
  if (!pin) {
    return proxyError(400, "pin_required", "pin is required");
  }

  return proxyToAgent({
    target: host.target,
    path: "/api/dashboard/pin/set",
    method: "POST",
    apiKey,
    json: { pin },
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
