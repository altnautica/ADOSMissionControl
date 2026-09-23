/**
 * @module LanPairProbeRoute
 * @description Server-side proxy for the LAN agent's
 * `/api/pairing/info` endpoint. Lets the browser probe a LAN agent
 * from an HTTPS Mission Control deployment without tripping the
 * browser's mixed-content guard — the cross-protocol step happens
 * server-side from Mission Control's Next.js layer instead of the
 * browser.
 *
 * Only forwards requests to private / mDNS / loopback hosts (SSRF
 * whitelist via `normaliseAndCheckHost`). A JSON body and status are
 * forwarded unchanged (see `../_proxy`) so the downstream pair client can
 * treat this route as a drop-in replacement for the direct fetch.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import { resolveIpv4 } from "../_ipv4";
import {
  callAgent,
  checkAgentHost,
  jsonReply,
  readJsonEnvelope,
  relayReply,
} from "../_proxy";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  // Talk to the agent over IPv4 so a .local host doesn't burn ~5 s on the
  // IPv6/AAAA lookup before falling back (see ../_ipv4). The 8 s timeout
  // stays as a backstop; with IPv4 the round-trip is sub-second.
  const reply = await callAgent({
    target: host.target,
    path: "/api/pairing/info",
    method: "GET",
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
  if ("reject" in reply) return reply.reject;

  const info = reply.value;
  if (
    reply.status < 200 ||
    reply.status >= 300 ||
    !info ||
    typeof info !== "object" ||
    Array.isArray(info)
  ) {
    return relayReply(reply);
  }

  // Augment the agent's body with a server-resolved IPv4 hint so the GCS has
  // a fallback when the OS-level mDNS resolver in the browser stops returning
  // the .local hostname. This reuses the lookup the upstream call already did
  // (an OS resolver cache hit), so it costs nothing.
  const parsed = info as Record<string, unknown>;
  const ipv4 = await resolveIpv4(host.target.host);
  if (ipv4 && !parsed.ipv4) parsed.ipv4 = ipv4;
  return jsonReply(reply.status, parsed);
}
