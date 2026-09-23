/**
 * @module LanPairPinClearRoute
 * @description Server-side proxy for the LAN agent's `/api/dashboard/pin/clear`
 * endpoint (reset the dashboard-access PIN).
 *
 * The browser POSTs `{ host, apiKey }`. The server forwards the API key in
 * `X-ADOS-Key`, which the agent's normal auth gate requires for this route.
 * Clearing rotates the salt the session tokens are keyed with, so every browser
 * currently unlocked on that node's dashboard is signed out. A JSON body + status
 * are returned unchanged (see `../_proxy`).
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

  return proxyToAgent({
    target: host.target,
    path: "/api/dashboard/pin/clear",
    method: "POST",
    apiKey,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
