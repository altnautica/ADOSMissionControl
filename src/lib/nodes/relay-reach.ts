"use client";

/**
 * @module nodes/relay-reach
 * @description One resolver for "can the GCS reach this drone through its
 * ground station's WFB relay, and at what URL".
 *
 * A drone reached only over a ground node's radio has no IP address of its
 * own. The ground station's
 * `/api/v1/ground-station/relay-proxy/{peerDeviceId}/*` route forwards an
 * HTTP call to it over the aux radio lane, so an `AgentClient` pointed at that
 * prefix reaches the drone's own API exactly as a directly-paired one does.
 *
 * The reach resolves from `local-nodes-store` via `resolveLocalAgentForDrone`,
 * the same source every other agent lane uses. It deliberately does NOT read
 * `FleetNodeEntry.mdnsHost ?? lastIp`: `adaptLocal()` populates `lastIp` only
 * from a cloud shadow and never maps `LocalNode.hostname`, so a LAN-only
 * ground station with no mDNS host would resolve to no reach even while the
 * GCS is talking to it.
 *
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";

/** The ground-station relay-proxy reach for a WFB-linked drone. Carries
 * the ground node's host + API key and the linked drone's peer device id,
 * so the GCS can route `/api/...` calls through the ground station's
 * relay-proxy route. */
export interface RelayReach {
  /** The ground station's base URL (e.g. `http://192.168.1.50:8080`). */
  baseUrl: string;
  /** The ground station's API key (X-ADOS-Key). */
  apiKey: string;
  /** The linked drone's device id, forwarded as a path segment. */
  peerDeviceId: string;
}

/** The relay-proxy base URL an AgentClient is constructed against. */
export function relayProxyBaseUrl(reach: RelayReach): string {
  return `${reach.baseUrl}/api/v1/ground-station/relay-proxy/${reach.peerDeviceId}`;
}

/**
 * Resolve the relay-proxy reach for a drone reached only through a ground
 * node's WFB relay.
 *
 * Null when the drone has direct reach (`agentDeviceId !== null`), has no
 * ground node (`reachedVia` absent), or that ground node is not LAN-paired on
 * this browser.
 */
export function resolveRelayReach(input: {
  agentDeviceId: string | null;
  reachedVia: string | null | undefined;
  droneDeviceId: string;
}): RelayReach | null {
  // A directly-reachable node needs no relay; using one would route its own
  // API through a third node for no reason.
  if (input.agentDeviceId !== null) return null;
  if (!input.reachedVia) return null;

  const groundDeviceId = deviceIdFromNodeId(input.reachedVia);
  if (!groundDeviceId) return null;

  const ground = resolveLocalAgentForDrone(groundDeviceId);
  if (!ground) return null;

  return {
    baseUrl: ground.agentUrl,
    apiKey: ground.apiKey,
    peerDeviceId:
      deviceIdFromNodeId(input.droneDeviceId) ?? input.droneDeviceId,
  };
}
