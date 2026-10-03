/**
 * @module stores/ground-station/fleet-slots-store
 * @description The fleet slot table each LAN-paired ground station last
 * reported, keyed by the ground station's device id. Fed by
 * `RelayedDroneBridge`'s poll; read by the relayed MAVLink session (which
 * waits for a drone's system id before dialing), the relayed video funnel
 * (which only labels the served slot's video as that drone's) and the node
 * notices (system id collisions, relay credential state).
 *
 * A ground station that could not be read keeps no entry, so "no slot row"
 * means "not known", never "not in the fleet".
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { FleetSlotRow } from "@/lib/api/ground-station/types";

export interface GroundFleetSlots {
  slots: readonly FleetSlotRow[];
  fetchedAt: number;
}

interface FleetSlotsState {
  byGround: Readonly<Record<string, GroundFleetSlots>>;
  /** Replace one ground station's table, or drop it when `slots` is null. */
  setGroundSlots: (groundDeviceId: string, slots: readonly FleetSlotRow[] | null) => void;
}

export const useFleetSlotsStore = create<FleetSlotsState>((set) => ({
  byGround: {},
  setGroundSlots(groundDeviceId, slots) {
    set((s) => {
      const next = { ...s.byGround };
      if (slots === null) delete next[groundDeviceId];
      else next[groundDeviceId] = { slots, fetchedAt: Date.now() };
      return { byGround: next };
    });
  },
}));

/** The slot row a ground station holds for `droneDeviceId`, or null when that
 * station's table is unknown or does not list the drone. */
export function slotRowFor(
  byGround: Readonly<Record<string, GroundFleetSlots>>,
  groundDeviceId: string,
  droneDeviceId: string,
): FleetSlotRow | null {
  return byGround[groundDeviceId]?.slots.find((r) => r.device_id === droneDeviceId) ?? null;
}

/** The MAVLink system ids two or more of a station's slots share. */
export function conflictingSystemIds(slots: readonly FleetSlotRow[]): number[] {
  const ids = new Set<number>();
  for (const row of slots) {
    if (row.system_id_conflict && row.fc_system_id !== null) ids.add(row.fc_system_id);
  }
  return [...ids].sort((a, b) => a - b);
}
