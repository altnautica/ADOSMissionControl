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
 * server proxy for a same-network dial). The upstream JSON body and status
 * are returned unchanged (see `../_proxy`) so an unreachable engine's `{"detections": []}` reading
 * or a 502 surfaces exactly as the agent produced it.
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
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  // This route only serves the relay lane (see module doc) — a missing or
  // invalid peer id is a caller bug, not a silent LAN downgrade.
  const peerDeviceId = env.payload.peerDeviceId;
  if (!isValidPeerDeviceId(peerDeviceId)) {
    return proxyError(
      400,
      "bad_peer_device_id",
      "peerDeviceId must be a device id (letters, digits, dot, dash, underscore; 32 chars max)",
    );
  }

  return proxyToAgent({
    target: host.target,
    path: `${RELAY_PROXY_PREFIX}/${peerDeviceId}${UPSTREAM_PATH}`,
    method: "GET",
    apiKey: String(env.payload.apiKey ?? "").trim(),
    timeoutMs: RELAY_UPSTREAM_TIMEOUT_MS,
  });
}
