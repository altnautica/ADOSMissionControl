/**
 * @module command/bridges/status-mapper/urls
 * @description Resolves the video (WHEP) and MAVLink WebSocket URLs the
 * connection cascade should attempt next, from the heartbeat's video /
 * mavlink blocks plus a LAN-host fallback. Prefers an IPv4 host over a
 * `.local` name to dodge a slow AAAA lookup. Pure.
 * @license GPL-3.0-only
 */

import type { VideoStreamLeg } from "@/lib/agent/feature-types";
import {
  agentMediaBase,
  resolveMediaPath,
} from "@/lib/agent/video-url";

/** Swap a `.local` host in `url` for `lastIp` when known. Resolving `.local`
 * in the browser tries AAAA/IPv6 first and hangs ~5s on a box with no usable
 * IPv6, blowing the browser-direct video + MAVLink-WS connect timeouts. The
 * IPv4 connects instantly. Hosts that are already an IP are left untouched. */
function preferIpv4Host(url: string, lastIp: string | undefined): string {
  if (!lastIp) return url;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase().endsWith(".local")) {
      u.hostname = lastIp;
      return u.toString();
    }
  } catch {
    /* not a parseable URL; leave as-is */
  }
  return url;
}

/**
 * The video URLs a node advertises, as the GCS can actually use them.
 *
 * WHEP only. The agent also advertises an HLS playlist, and this used to
 * resolve it end-to-end — into `VideoStreamUrls.hlsUrl` and a per-leg
 * `hlsUrl` — for zero consumers: nothing in this app imports hls.js, builds a
 * `MediaSource` for a playlist, or assigns an `.m3u8` to a `<video>`. That is
 * not a latent fallback, it is a resolved URL that no surface can play, and it
 * read as a fallback to anyone reading the types. HLS is also 2-6 s behind
 * live, which is not a figure a piloting surface can present as current, and
 * the case it would serve — a drone behind a ground station — is already
 * carried over WHEP by the funneled feed. The agent keeps serving `/hls/…`
 * for its own on-box cockpit; that client is not this one.
 */
export interface VideoStreamUrls {
  state: string | undefined;
  whepUrl: string | null;
  lanHost: string | null;
}

/**
 * Resolve the WHEP URL the cascade should attempt next, given the
 * heartbeat's video block + a possible LAN host fallback.
 */
export function resolveVideoUrls(
  cloudStatus: Record<string, unknown>,
  lanHost: string | null,
): VideoStreamUrls {
  const videoState = cloudStatus.videoState as string | undefined;
  const videoWhepUrl = cloudStatus.videoWhepUrl as string | undefined;
  const lastIp = cloudStatus.lastIp as string | undefined;

  // Agents advertise a RELATIVE WHEP path (`/whep`) served by their own :8080
  // front, the origin this GCS reaches `/api/*` against and the only one that
  // authenticates it. mediamtx's own WHEP port is loopback-only on the node, so
  // nothing is synthesized against it. No advertised URL means no stream.
  const base = agentMediaBase(lastIp);

  let whepUrl: string | null = null;
  if (videoState === "running" && videoWhepUrl) {
    whepUrl = videoWhepUrl.startsWith("/")
      ? resolveMediaPath(videoWhepUrl, base)
      : preferIpv4Host(videoWhepUrl, lastIp);
  }

  return { state: videoState, whepUrl, lanHost };
}

/** Resolve the per-leg video streams a cloud-relayed multi-stream node
 * advertises to dialable URLs against the node's :8080 front, for the cockpit
 * stream switcher. Empty unless the pipeline is running; a leg with no
 * advertised path is left out rather than guessed. */
export function resolveVideoStreams(
  cloudStatus: Record<string, unknown>,
): VideoStreamLeg[] {
  const videoState = cloudStatus.videoState as string | undefined;
  const streams = cloudStatus.videoStreams as
    | {
        id: string;
        role?: string;
        codec?: string;
        live?: boolean | null;
        whep?: string;
      }[]
    | undefined;
  if (videoState !== "running" || !streams?.length) return [];
  const base = agentMediaBase(cloudStatus.lastIp as string | undefined);
  // Only a leg the node advertised is dialable; its relative path resolves
  // against the node's :8080 front.
  return streams.flatMap((s) => {
    const whepUrl = s.id && s.whep ? resolveMediaPath(s.whep, base) : null;
    return whepUrl
      ? [{ id: s.id, role: s.role, codec: s.codec, live: s.live, whepUrl }]
      : [];
  });
}

export interface MavlinkUrl {
  /** The raw MAVLink WebSocket proxy URL (port 8765 on shipped agents).
   * The connection cascade dials this for any profile and, when a pairing
   * key is held, attaches a freshly-minted ticket as a WebSocket
   * subprotocol — authentication is orthogonal to the URL, so there is no
   * separate authenticated endpoint. */
  url: string | null;
}

/**
 * Resolve the MAVLink WebSocket URL the connection store should advertise.
 * ``url`` is the raw proxy (heartbeat-published URL, then a port hint +
 * lastIp, then the LAN-host default port 8765). The cascade dials it bare
 * for an unpaired agent and with a ticket subprotocol when a pairing key is
 * held.
 */
export function resolveMavlinkUrl(
  cloudStatus: Record<string, unknown>,
  lanHost: string | null,
): MavlinkUrl {
  const mavlinkWsPort = cloudStatus.mavlinkWsPort as number | undefined;
  const mavlinkWsUrl = cloudStatus.mavlinkWsUrl as string | undefined;
  const lastIp = cloudStatus.lastIp as string | undefined;

  let url: string | null = null;
  if (mavlinkWsUrl) {
    url = preferIpv4Host(mavlinkWsUrl, lastIp);
  } else if (lastIp && mavlinkWsPort && mavlinkWsPort > 0) {
    url = `ws://${lastIp}:${mavlinkWsPort}/`;
  } else if (lanHost) {
    // ados-mavlink defaults to port 8765 across all shipped agents.
    url = `ws://${lanHost}:8765/`;
  }

  return { url };
}
