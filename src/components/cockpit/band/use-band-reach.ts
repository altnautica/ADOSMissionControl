"use client";

/**
 * How this browser reaches the cockpit's drone, as the safety band's badge.
 *
 * Derived from two facts the GCS actually holds: the transport its managed
 * MAVLink session runs on, and the presence sources the node registry has
 * seen for the node that session is attached to. Nothing is inferred from
 * pairing fields, so the badge is only ever a reach that is carrying traffic.
 *
 *   DIRECT     — the flight controller is attached to this browser (serial,
 *                BLE, TCP, a UDP proxy, or a WebSocket with no agent presence)
 *   LAN        — the node's agent is reached on the local network
 *   VIA GROUND — the node is only reached through a ground station's radio
 *   CLOUD      — MAVLink rides the cloud relay. A WebSocket session is never
 *                the cloud path, whatever presence the node also has.
 *
 * `null` when no managed session exists for the drone: the band hides the
 * badge rather than naming a reach nothing is using.
 *
 * @license GPL-3.0-only
 */

import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { PresenceSource } from "@/stores/node-registry";
import type { ConnectionMeta } from "@/lib/connection-meta";

export type BandReach = "direct" | "lan" | "relayed" | "cloud";

/** Resolve the badge from the session transport and the node's presence. */
export function resolveBandReach(
  transport: ConnectionMeta["type"] | null,
  sources: readonly PresenceSource[],
): BandReach {
  if (transport === "mqtt-mavlink") return "cloud";
  if (transport !== null && transport !== "websocket") return "direct";
  if (sources.includes("local")) return "lan";
  if (sources.includes("relayed")) return "relayed";
  // Cloud presence names the reach only when the session's transport is not
  // known; a WebSocket carries no cloud traffic.
  if (transport === null && sources.includes("cloud")) return "cloud";
  return "direct";
}

const NO_SOURCES: readonly PresenceSource[] = [];

export function useBandReach(droneId: string): BandReach | null {
  const managed = useDroneManager((s) => s.drones.has(droneId));
  const transport = useDroneManager(
    (s) => s.drones.get(droneId)?.connectionMeta?.type ?? null,
  );
  // The presence array is replaced, never mutated, when a source changes, so
  // its identity is a stable selector result between changes.
  const sources = useNodeRegistryStore((s) => {
    for (const entry of Object.values(s.nodes)) {
      if (entry.fc.managedId === droneId) return entry.presence.sources;
    }
    return NO_SOURCES;
  });
  if (!managed) return null;
  return resolveBandReach(transport, sources);
}
