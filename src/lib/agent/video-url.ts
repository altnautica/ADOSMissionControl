/**
 * @module agent/video-url
 * @description Resolve the reachable WHEP URL for a node's primary video feed
 * from its {@link CommandCloudStatus}. Shared so the fleet grid and the
 * transitive funneled-feed re-registration build the identical URL.
 *
 * The agent echoes its WHEP URL using the Host header of the poll, which can be
 * an mDNS name (e.g. `skynodepi.local`) the browser cannot resolve, or null on
 * older agents. mediamtx serves WHEP on the same box at the WHEP port
 * (default 8889), so the URL is rebuilt from the known-reachable `lastIp`
 * whenever one is present, falling back to whatever the agent advertised.
 * @license GPL-3.0-only
 */

import type { CommandCloudStatus } from "@/stores/command-fleet-store";

/** The playable WHEP URL for a node's primary (`/main`) feed, or null when the
 * node is not streaming. */
export function resolveAgentVideoUrl(
  status: CommandCloudStatus | undefined,
): string | null {
  if (!status || status.videoState !== "running") return null;
  const port =
    status.videoWhepPort && status.videoWhepPort > 0
      ? status.videoWhepPort
      : 8889;
  if (status.lastIp) return `http://${status.lastIp}:${port}/main/whep`;
  return status.videoWhepUrl ?? null;
}
