/**
 * @module LanPairVisionDetectionsLatestRoute
 * @description Server-side proxy for `GET /api/vision/detections/latest` —
 * the poll target for a WFB-relayed drone's live-detection feed. Sibling to
 * the config / vision-detector proxy routes (Rule 39 local-first): lets an
 * HTTPS Mission Control read a plain-HTTP LAN or ground-station host without
 * tripping the browser's mixed-content guard, and resolves `*.local`
 * server-side.
 *
 * A raw WebSocket cannot cross the ground station's relay-proxy
 * (`gs_relay_proxy.rs` tunnels one unary HTTP request/response pair over the
 * aux radio lane per call; there is no upgrade passthrough for a persistent
 * duplex stream). `VisionDetectionsBridge`'s relay branch therefore polls
 * this route on an interval instead of holding a socket open — the agent's
 * `GET /api/vision/detections/latest` reads one frame off the same
 * last-state broadcast the WS route streams from and returns it as JSON, so
 * a single unary call fits the relay-proxy's shape exactly. The LAN branch
 * still dials `connectVisionDetections`'s real WebSocket directly; this
 * route exists only for the relay lane.
 *
 * The browser POSTs `{ host, apiKey, peerDeviceId }` — `peerDeviceId` is
 * required (this route has no LAN-direct use; the LAN branch never needed a
 * server proxy for a same-network dial). The upstream body and status are
 * returned verbatim so an unreachable engine's `{"detections": []}` reading
 * or a 502 surfaces exactly as the agent produced it.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";
import { normaliseAndCheckHost } from "@/lib/agent/host-validation";
import { ipv4FetchBase } from "../_ipv4";
import { isValidPeerDeviceId } from "../_peer-device-id";

export const runtime = "nodejs";

/** The relay lane crosses a WFB radio; mirrors the config route's relay
 * ceiling, which sits ABOVE the ground station's own ~10 s relay bound.
 *
 * This previously read 8000 while claiming to mirror that ceiling, which put it
 * below the agent's bound and inverted the layering: the client aborted first,
 * so the agent's honest gateway timeout — the one carrying how many fragments
 * of the answer actually arrived — was never delivered, and a merely slow radio
 * surfaced as a generic unreachable-upstream error instead. The aborted call
 * also kept retransmitting on the agent side for the remaining two seconds,
 * spending airtime on an answer nobody was waiting for.
 *
 * A poll that times out just means the caller's next tick tries again; the
 * caller holds a re-entrancy guard, so a longer ceiling cannot pile requests up.
 * This is never the sole source of truth for liveness. */
const RELAY_UPSTREAM_TIMEOUT_MS = 15000;

const RELAY_PROXY_PREFIX = "/api/v1/ground-station/relay-proxy";
const UPSTREAM_PATH = "/api/vision/detections/latest";

export async function POST(req: NextRequest) {
  let payload: { host?: string; apiKey?: string; peerDeviceId?: unknown };
  try {
    payload = (await req.json()) as {
      host?: string;
      apiKey?: string;
      peerDeviceId?: unknown;
    };
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

  // This route only serves the relay lane (see module doc) — a missing or
  // invalid peer id is a caller bug, not a silent LAN downgrade.
  const peerDeviceId = payload?.peerDeviceId;
  if (!isValidPeerDeviceId(peerDeviceId)) {
    return NextResponse.json(
      {
        error: "bad_peer_device_id",
        message:
          "peerDeviceId must be a device id (letters, digits, dot, dash, underscore; 32 chars max)",
      },
      { status: 400 },
    );
  }

  const upstreamPath = `${RELAY_PROXY_PREFIX}/${peerDeviceId}${UPSTREAM_PATH}`;
  const apiKey = String(payload?.apiKey ?? "").trim();

  try {
    const base = await ipv4FetchBase(target);
    const upstream = await fetch(`${base}${upstreamPath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "X-ADOS-Key": apiKey } : {}),
      },
      signal: AbortSignal.timeout(RELAY_UPSTREAM_TIMEOUT_MS),
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "upstream_unreachable",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
