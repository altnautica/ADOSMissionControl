/**
 * @module LanPairClaimRoute
 * @description Server-side proxy for the LAN agent's
 * `/api/pairing/claim` endpoint. Sibling to the probe route.
 *
 * The browser POSTs `{ host, userId }`. Server forwards
 * `{ user_id }` to the agent at the validated host. A JSON body and
 * status are returned unchanged (see `../_proxy`) so the pair client can map the agent's
 * standard ClaimResponse without any extra translation.
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
import { LAN_PAIR_UPSTREAM_TIMEOUT_MS } from "@/lib/agent/local-pair/transport";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  const userId = String(env.payload.userId ?? "").trim();
  if (!userId) {
    return proxyError(400, "user_id_required", "userId is required");
  }

  // Resolved to IPv4 first so a .local host doesn't stall on AAAA (../_ipv4).
  return proxyToAgent({
    target: host.target,
    path: "/api/pairing/claim",
    method: "POST",
    json: { user_id: userId },
    timeoutMs: LAN_PAIR_UPSTREAM_TIMEOUT_MS,
  });
}
