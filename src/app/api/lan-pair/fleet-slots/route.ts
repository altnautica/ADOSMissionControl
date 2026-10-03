/**
 * @module LanPairFleetSlotsRoute
 * @description Server-side proxy for a ground agent's `GET /api/wfb/pair` —
 * the pair state plus the fleet slot table: which drone holds which slot, the
 * MAVLink system id heard on it, whether two slots share one, which slot's
 * video the station serves, and whether each drone holds the station's relay
 * credential.
 *
 * Mirrors the `relayed-status` route: the SSRF-checked host resolves over
 * IPv4 and the hop happens server-side, so an HTTPS Mission Control
 * deployment can reach a plain-HTTP LAN ground station. The caller's
 * `X-ADOS-Key` is forwarded, never generated or cached here.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import { checkAgentHost, proxyToAgent, readJsonEnvelope } from "../_proxy";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 6000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  return proxyToAgent({
    target: host.target,
    path: "/api/wfb/pair",
    method: "GET",
    apiKey: typeof env.payload.apiKey === "string" ? env.payload.apiKey : "",
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    unreachableMessage: "The ground station did not respond",
  });
}
