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

import { NextRequest, NextResponse } from "next/server";
import { normaliseAndCheckHost } from "@/lib/agent/host-validation";
import { ipv4FetchBase } from "../_ipv4";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 6000;

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
    const upstream = await fetch(
      `${base}/api/v1/ground-station/relayed/status`,
      {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    const text = await upstream.text();

    // Pass every status through verbatim, including 404 (no relay running)
    // and 401 (a stale key) — the client's own honest-empty handling reads
    // these directly rather than this proxy re-deciding what they mean.
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
