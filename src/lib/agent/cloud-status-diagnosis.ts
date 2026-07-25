"use client";

/**
 * Why no status arrived over the cloud relay for a node the GCS is watching.
 *
 * The relay is not the only reason a node ends up on this path. A LAN-paired
 * node whose page is served over HTTPS is routed here because the browser
 * refuses a plain-HTTP request to a private address, and an agent that was
 * deliberately configured to keep its relay switched off never publishes to the
 * relay at all. Both are correct configurations, and neither says anything
 * about whether the node is powered on.
 *
 * So a silent relay has several distinct causes, and each points the operator
 * somewhere different. This resolves which one applies from what the GCS
 * already knows about the node, and says nothing it cannot support: the offline
 * reading is reserved for a node that really is cloud-paired and really has
 * stopped reporting.
 *
 * @module agent/cloud-status-diagnosis
 * @license GPL-3.0-only
 */

import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import type { NodeCloudPosture } from "@/stores/node-registry";

/** What the GCS knows about a node whose relay has stayed silent. */
export interface CloudStatusDiagnosisInput {
  /** The node holds a cloud pairing row, so the relay is a lane it can use. */
  cloudPaired: boolean;
  /** The node holds LAN credentials in this browser. */
  lanPaired: boolean;
  /**
   * The relay posture the agent itself reports. `"local"` means the operator
   * turned the relay off on the agent, which is the shipped default, so silence
   * on the relay is the configured behavior and not a fault.
   */
  cloudPosture?: NodeCloudPosture;
  /** The page origin blocks a plain-HTTP request to a LAN address. */
  originIsHttps: boolean;
}

/**
 * The operator-facing reason a node's relay has carried no status. Pure, so the
 * mapping is testable without a browser or a store.
 */
export function diagnoseMissingCloudStatus(
  input: CloudStatusDiagnosisInput,
): string {
  const { cloudPaired, lanPaired, cloudPosture, originIsHttps } = input;

  if (cloudPosture === "local") {
    return lanPaired
      ? "This node keeps its cloud relay switched off, so no status will arrive over it. It is reachable directly on the LAN."
      : "This node keeps its cloud relay switched off, so no status will arrive over it. Pair it by hostname or address from the Add-a-Node card to reach it directly.";
  }

  if (!cloudPaired) {
    if (lanPaired) {
      return originIsHttps
        ? "This node is paired over the LAN only and publishes nothing to the cloud relay. This page is served over HTTPS, which blocks a direct request to a LAN address, so open the console over HTTP on the same network to reach it."
        : "This node is paired over the LAN only and publishes nothing to the cloud relay. Its direct LAN connection is the path to it.";
    }
    return "No pairing is held for this node, so neither the cloud relay nor a direct connection can reach it. Pair it again from the Add-a-Node card.";
  }

  return "No status has arrived over the cloud relay. The agent may be powered down or may have stopped reporting to the relay.";
}

/**
 * Read what the GCS knows about `deviceId` and name the reason its relay has
 * stayed silent. Reads the stores imperatively at call time, the same
 * local-first lookup pattern the LAN agent resolver uses.
 */
export function describeMissingCloudStatus(deviceId: string): string {
  const cloudPaired = usePairingStore
    .getState()
    .pairedDrones.some((d) => d.deviceId === deviceId);
  const lanPaired = useLocalNodesStore
    .getState()
    .nodes.some((n) => n.deviceId === deviceId && !!n.apiKey);
  const entry = useNodeRegistryStore
    .getState()
    .getEntry(nodeIdForDevice(deviceId));
  return diagnoseMissingCloudStatus({
    cloudPaired,
    lanPaired,
    cloudPosture: entry?.presence.cloudPosture,
    originIsHttps:
      typeof window !== "undefined" && window.location.protocol === "https:",
  });
}
