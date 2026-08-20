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

export interface VideoStreamUrls {
  state: string | undefined;
  whepUrl: string | null;
  hlsUrl: string | null;
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
  const videoWhepPort = cloudStatus.videoWhepPort as number | undefined;
  const videoWhepUrl = cloudStatus.videoWhepUrl as string | undefined;
  const videoHlsUrl = cloudStatus.videoHlsUrl as string | undefined;
  const lastIp = cloudStatus.lastIp as string | undefined;

  // Current agents advertise RELATIVE same-origin media paths (/whep, /hls/…)
  // served by the agent's own :8080 front — the same origin this GCS reaches
  // `/api/*` against. Resolve them against that base; an ABSOLUTE URL from an
  // older agent is kept (optionally `.local`→IPv4 swapped).
  const base = agentMediaBase(lastIp);

  let whepUrl: string | null = null;
  if (videoState === "running" && videoWhepUrl) {
    if (videoWhepUrl.startsWith("/")) {
      whepUrl = resolveMediaPath(videoWhepUrl, base);
    } else {
      whepUrl = preferIpv4Host(videoWhepUrl, lastIp);
    }
  } else if (
    videoState === "running" &&
    lastIp &&
    videoWhepPort &&
    videoWhepPort > 0
  ) {
    whepUrl = `http://${lastIp}:${videoWhepPort}/main/whep`;
  } else if (videoState === "running" && lanHost) {
    // mediamtx default WHEP port is stable across deployments.
    whepUrl = `http://${lanHost}:8889/main/whep`;
  }

  const hlsUrl =
    videoState === "running" && videoHlsUrl
      ? videoHlsUrl.startsWith("/")
        ? resolveMediaPath(videoHlsUrl, base)
        : preferIpv4Host(videoHlsUrl, lastIp)
      : null;

  return { state: videoState, whepUrl, hlsUrl, lanHost };
}

/** Resolve the per-leg video streams a cloud-relayed multi-stream node
 * advertises to dialable URLs against the node's reachable base (its LAN IP,
 * else the resolved LAN host), for the cockpit stream switcher. Empty unless
 * the pipeline is running and the node advertised more than the default leg. */
export function resolveVideoStreams(
  cloudStatus: Record<string, unknown>,
  lanHost: string | null,
): VideoStreamLeg[] {
  const videoState = cloudStatus.videoState as string | undefined;
  const streams = cloudStatus.videoStreams as
    | {
        id: string;
        role?: string;
        codec?: string;
        live?: boolean | null;
        whep?: string;
        hls?: string;
      }[]
    | undefined;
  if (videoState !== "running" || !streams?.length) return [];
  const lastIp = cloudStatus.lastIp as string | undefined;
  const host = lastIp || lanHost;
  const base = agentMediaBase(lastIp);
  if (!host) return [];
  return streams
    .filter((s) => s.id)
    .map((s) => {
      // Prefer the advertised RELATIVE path (current agents) resolved against
      // the agent base; fall back to rebuilding the legacy path form against
      // the reachable host.
      const whepUrl = s.whep
        ? s.whep.startsWith("/")
          ? resolveMediaPath(s.whep, base) ?? `http://${host}:8889/${s.id}/whep`
          : s.whep
        : `http://${host}:8889/${s.id}/whep`;
      const hlsUrl = s.hls
        ? resolveMediaPath(s.hls, base) ?? undefined
        : undefined;
      return {
        id: s.id,
        role: s.role,
        codec: s.codec,
        live: s.live,
        whepUrl,
        hlsUrl,
      };
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
