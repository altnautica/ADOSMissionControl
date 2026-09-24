"use client";

/**
 * Resolve the LAN-paired agent (base URL + pairing key) for a drone, read
 * imperatively at call time with no Convex round-trip.
 *
 * `resolveLocalAgentForDrone` reads `local-nodes-store` only (node and relay
 * lanes). `resolveLanAgent` is the one reach policy for every plugin wire
 * call. Both return null when the drone has no LAN reach; callers surface
 * that honestly rather than acting on the wrong agent.
 *
 * @module agent/resolve-agent
 * @license GPL-3.0-only
 */

import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

/** A resolved LAN agent target. */
export interface ResolvedLocalAgent {
  /** Base URL of the agent (no trailing slash handling needed; clients trim). */
  agentUrl: string;
  /** Pairing key for that agent. */
  apiKey: string;
}

/** Resolve the LAN agent for `droneId`, or null when it is not LAN-paired. */
export function resolveLocalAgentForDrone(
  droneId: string,
): ResolvedLocalAgent | null {
  const node = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === droneId);
  if (!node?.hostname || !node?.apiKey) return null;
  return { agentUrl: node.hostname, apiKey: node.apiKey };
}

/** Build a LAN URL from any cached pairing record (browser-local
 * ``local-nodes-store`` or Convex-mediated ``pairing-store``). Returns
 * null when no usable host is available; callers fall back to the
 * Convex heartbeat metadata.
 *
 * On HTTPS origins the browser blocks plain-HTTP fetches to a private
 * LAN host (mixed content). Returning null here lets the cloud-relay
 * cascade take over cleanly instead of surfacing a "Failed to fetch"
 * error from a doomed direct call. The LAN-direct optimisation is only
 * meaningful when the GCS page is served from an HTTP origin (e.g.
 * the local dev server, an Electron shell, or a self-hoster running
 * the GCS on the same LAN as the drone). */
export function resolveLanAgentUrl(deviceId: string): string | null {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:"
  ) {
    return null;
  }
  return resolvePairedAgentUrl(deviceId);
}

/** The paired node's own agent URL from its pairing record, whatever the page
 * origin. A caller on an HTTPS page must reach it through a same-origin proxy
 * (`/api/lan-pair/*`), never directly. */
export function resolvePairedAgentUrl(deviceId: string): string | null {
  // local-nodes-store wins because it's the truth source for LAN-only
  // pairings (no Convex round-trip required) and stores ipv4 alongside
  // mdnsHost so non-mDNS browsers still resolve.
  const localNode = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (localNode) {
    // hostname is already normalised to include scheme + port.
    if (localNode.hostname) return localNode.hostname;
    const host = localNode.mdnsHost || localNode.ipv4;
    if (host) return `http://${host}:8080`;
  }
  const pairedDrone = usePairingStore
    .getState()
    .pairedDrones.find((d) => d.deviceId === deviceId);
  if (pairedDrone) {
    const host = pairedDrone.mdnsHost || pairedDrone.lastIp;
    if (host) return `http://${host}:8080`;
  }
  return null;
}

/** Look up the paired API key for direct LAN HTTP calls. Prefers the
 * browser-local pairing record (LAN-only path) over the Convex-mediated
 * one. */
export function resolvePairedApiKey(deviceId: string): string | null {
  const localNode = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (localNode?.apiKey) return localNode.apiKey;
  const pairedDrone = usePairingStore
    .getState()
    .pairedDrones.find((d) => d.deviceId === deviceId);
  return pairedDrone?.apiKey ?? null;
}

/**
 * Resolve the LAN agent a plugin wire call (install, capability-token mint,
 * config write, plugin client, vision designate) reaches for `deviceId`. Built
 * on the two LAN resolvers above, so a node paired through either
 * `local-nodes-store` or `pairing-store` is reachable on every plugin path.
 * Null on an HTTPS origin (mixed content blocks the plain-HTTP LAN host) or
 * when no URL or pairing key is known.
 */
export function resolveLanAgent(deviceId: string): ResolvedLocalAgent | null {
  const agentUrl = resolveLanAgentUrl(deviceId);
  const apiKey = resolvePairedApiKey(deviceId);
  if (!agentUrl || !apiKey) return null;
  return { agentUrl, apiKey };
}
