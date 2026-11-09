/**
 * @module cockpit/ground-station-link
 * @description Whether this surface reaches a drone through a ground station
 * (the drone is linked over the ground node's radio). Only then can the
 * ground station's ELRS radio fly it, so only then does the Mode sheet offer
 * the `elrs` control mode.
 *
 * The detector reads the node registry: a drone enrolled through a ground
 * node carries the `relayed` presence source and names that node in
 * `reachedVia`.
 *
 * @license GPL-3.0-only
 */

import { useNodeRegistryStore } from "@/stores/node-registry";
import type { NodePresence } from "@/stores/node-registry";

/** Pure rule over one node's presence. */
export function reachedThroughGroundStation(
  presence: Pick<NodePresence, "sources" | "reachedVia"> | null | undefined,
): boolean {
  if (!presence) return false;
  return presence.sources.includes("relayed") || (presence.reachedVia ?? "") !== "";
}

/** The detector for the drone whose managed id is `droneId`. */
export function useGroundStationLink(droneId: string): boolean {
  return useNodeRegistryStore((s) => {
    for (const entry of Object.values(s.nodes)) {
      if (entry.fc.managedId === droneId || entry.presence.deviceId === droneId) {
        return reachedThroughGroundStation(entry.presence);
      }
    }
    return false;
  });
}
