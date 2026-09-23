/**
 * @module LanPairSwarmNeighborsRoute
 * @description Server-side proxy for an agent's `GET /api/swarm/neighbors` —
 * the decoded swarm-bus beacon table (one entry per fleet slot the node has
 * heard from) that the Swarm tab renders.
 *
 * Mirrors the `relayed-status` route exactly: the SSRF-checked host resolves
 * over IPv4 and the hop happens server-side, so an HTTPS Mission Control
 * deployment can reach a plain-HTTP LAN ground station without tripping the
 * browser's mixed-content guard. The caller's `X-ADOS-Key` is forwarded —
 * never generated or cached here.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import { checkAgentHost, proxyToAgent, readJsonEnvelope } from "../_proxy";

export const runtime = "nodejs";

/** Tighter than the relayed-status hop: this is polled at 2 Hz, so a request
 * that outlives two poll intervals is already useless to the caller. */
const UPSTREAM_TIMEOUT_MS = 4000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  // Every JSON status passes through unchanged, including 404 (an agent build
  // without the swarm bus) and 401 (a stale key) — the client's honest-null
  // handling reads these directly rather than this proxy re-deciding.
  return proxyToAgent({
    target: host.target,
    path: "/api/swarm/neighbors",
    method: "GET",
    apiKey: typeof env.payload.apiKey === "string" ? env.payload.apiKey : "",
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    unreachableMessage: "The ground station did not respond",
  });
}
