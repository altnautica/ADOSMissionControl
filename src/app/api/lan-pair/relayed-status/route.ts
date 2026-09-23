/**
 * @module LanPairRelayedStatusRoute
 * @description Server-side proxy for a ground agent's
 * `GET /api/v1/ground-station/relayed/status` — what that ground station knows
 * about the drones it relays over the radio (identity, flight-controller
 * reachability, service health, resources), sourced from the node-status
 * snapshots those drones push over the WFB auxiliary lane.
 *
 * Mirrors the `probe` route: the SSRF-checked host resolves over IPv4, and the
 * hop happens server-side so an HTTPS Mission Control deployment can reach a
 * plain-HTTP LAN ground station without tripping the browser's mixed-content
 * guard. Unlike `probe` (unauthenticated pairing discovery), this route is
 * gated on the ground station once paired, so the caller's `X-ADOS-Key` is
 * forwarded — never generated or cached here.
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

  // Every JSON status passes through unchanged, including 404 (no relay
  // running) and 401 (a stale key) — the client's own honest-empty handling
  // reads these directly rather than this proxy re-deciding what they mean.
  return proxyToAgent({
    target: host.target,
    path: "/api/v1/ground-station/relayed/status",
    method: "GET",
    apiKey: typeof env.payload.apiKey === "string" ? env.payload.apiKey : "",
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    unreachableMessage: "The ground station did not respond",
  });
}
