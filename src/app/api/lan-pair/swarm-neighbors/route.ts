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

import { NextRequest, NextResponse } from "next/server";
import { normaliseAndCheckHost } from "@/lib/agent/host-validation";
import { ipv4FetchBase } from "../_ipv4";

export const runtime = "nodejs";

/** Tighter than the relayed-status hop: this is polled at 2 Hz, so a request
 * that outlives two poll intervals is already useless to the caller. */
const UPSTREAM_TIMEOUT_MS = 4000;

export async function POST(req: NextRequest) {
  let payload: { host?: string; apiKey?: string };
  try {
    payload = (await req.json()) as { host?: string; apiKey?: string };
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const target = normaliseAndCheckHost(payload?.host ?? "");
  if ("error" in target) {
    return NextResponse.json(
      { error: target.error, message: target.message },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof payload.apiKey === "string" && payload.apiKey.length > 0) {
    headers["X-ADOS-Key"] = payload.apiKey;
  }

  try {
    const base = await ipv4FetchBase(target);
    const upstream = await fetch(`${base}/api/swarm/neighbors`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();

    // Every status passes through verbatim, including 404 (an agent build
    // without the swarm bus) and 401 (a stale key) — the client's honest-null
    // handling reads these directly rather than this proxy re-deciding.
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { error: "upstream_unreachable", message: "The ground station did not respond" },
      { status: 502 },
    );
  }
}
