/**
 * @module agent/video-url
 * @description Resolve the reachable WHEP URL for a node's primary video feed
 * from its {@link CommandCloudStatus}. Shared so the fleet grid and the
 * transitive funneled-feed re-registration build the identical URL.
 *
 * The agent echoes its WHEP URL using the Host header of the poll, which can be
 * an mDNS name (e.g. `drone.local`) the browser cannot resolve, or null on
 * older agents. mediamtx serves WHEP on the same box at the WHEP port
 * (default 8889), so the URL is rebuilt from the known-reachable `lastIp`
 * whenever one is present, falling back to whatever the agent advertised.
 * @license GPL-3.0-only
 */

import type { CommandCloudStatus } from "@/stores/command-fleet-store";

/** The agent's control front that the GCS reaches `/api/*` against, rebuilt
 * from the known-reachable LAN IP. Current agents proxy WHEP (`/whep`) on this
 * same `:8080` front, so a RELATIVE video path resolves to that origin —
 * same-origin with the `/api/*` poll and (through the LAN-pair proxy on a
 * hosted GCS) HTTPS-mixed-content-safe. A `.local`/mDNS host is never used
 * here. `null` when we have no reachable IP to build an origin from. */
export function agentMediaBase(lastIp: string | undefined): string | null {
  return lastIp ? `http://${lastIp}:8080` : null;
}

/** Resolve a WHEP path the agent advertised into a playable URL. A RELATIVE
 * path (starts with `/`) — the contract of current agents — is prefixed with
 * the agent base to become an absolute same-origin URL. An already-absolute
 * URL (older agent / CDN / relay) is left untouched. Returns `null` when
 * nothing is advertised or a relative path has no base to resolve against. */
export function resolveMediaPath(
  path: string | null | undefined,
  base: string | null,
): string | null {
  if (!path) return null;
  if (path.startsWith("/")) return base ? `${base}${path}` : null;
  return path;
}

/**
 * The playable WHEP URL for a node's primary (`/main`) feed, or `null` when
 * the node is not streaming.
 *
 * WHEP only. This used to be a two-field `resolveAgentVideoUrls` that also
 * resolved the agent's HLS playlist and described it as "the remote fallback".
 * Nothing in this app can play a playlist — no hls.js, no `MediaSource` for
 * one, no `.m3u8` ever assigned to a `<video>` — so the second field was a
 * resolved URL with no consumer that read, to anyone maintaining this, as a
 * fallback that existed. HLS also sits 2-6 s behind live, which a piloting
 * surface cannot present as current, and the relay case it would cover is
 * already served over WHEP by a ground station's funneled feed.
 */
export function resolveAgentVideoUrl(
  status: CommandCloudStatus | undefined,
): string | null {
  if (!status || status.videoState !== "running") return null;
  const base = agentMediaBase(status.lastIp);
  const advertised = status.videoWhepUrl;
  if (advertised) return resolveMediaPath(advertised, base);
  // Older agent with no advertised URL: rebuild from IP + port.
  if (!status.lastIp) return null;
  const port =
    status.videoWhepPort && status.videoWhepPort > 0
      ? status.videoWhepPort
      : 8889;
  return `http://${status.lastIp}:${port}/main/whep`;
}
