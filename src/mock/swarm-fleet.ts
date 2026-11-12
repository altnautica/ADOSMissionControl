/**
 * @module mock/swarm-fleet
 * @description The demo swarm bus's fixed slot table and per-slot condition
 * constants, split out of `swarm-beacons.ts` to keep both files under the
 * repo's soft LOC target.
 *
 * The slot table is derived from `DEMO_DRONES` rather than hand-duplicated,
 * so the two can never drift: the slots are exactly the fixture's entries
 * with `hasAgent !== false`, in fixture order. `bravo-2` is excluded on a
 * real rule, not a whim — the swarm bus runs on the companion SBC, and
 * `bravo-2` is the FC-only demo drone with no companion agent.
 *
 * Every condition below is keyed by device id and resolved to its slot, so
 * adding or removing a demo drone never shifts a condition onto a different
 * drone.
 *
 * Per-slot condition assignment below is FIXED, never random: the demo must
 * read identically on every load, or a screenshot means nothing. Exactly one
 * slot carries each of the four reachable exception severities.
 *
 * @license GPL-3.0-only
 */

import { DEMO_DRONES, type DemoDroneConfig } from "./drones";

/** One beaconing slot: its number and the demo drone occupying it. */
export interface DemoSwarmSlot {
  slot: number;
  deviceId: string;
}

/** Every demo drone with a companion agent, in fixture order, numbered from 1. */
export const BEACON_SLOTS: readonly DemoSwarmSlot[] = DEMO_DRONES.filter(
  (d) => d.hasAgent !== false,
).map((d, i) => ({ slot: i + 1, deviceId: d.id }));

/** Home position + config lookup for a beaconing slot's device id. */
export const CFG_BY_DEVICE_ID: ReadonlyMap<string, DemoDroneConfig> = new Map(
  DEMO_DRONES.map((d) => [d.id, d]),
);

/** The slot a beaconing demo drone occupies. Throws when the id is not in the
 * beacon table, so a removed drone fails loudly instead of silently moving a
 * condition onto whichever drone now holds its old slot number. */
export function slotOf(deviceId: string): number {
  const index = BEACON_SLOTS.findIndex((s) => s.deviceId === deviceId);
  if (index < 0) throw new Error(`demo swarm: ${deviceId} has no beacon slot`);
  return BEACON_SLOTS[index].slot;
}

/** Emergency bit set, precedence `hard-separation` — the separation layer
 * taking over IS what raises the emergency bit, so the two must agree or the
 * beacon would be incoherent. */
export const EMERGENCY_ID = "echo-5";
export const EMERGENCY_SLOT = slotOf(EMERGENCY_ID);

/** No GPS fix. */
export const NO_GPS_ID = "india-9";
export const NO_GPS_SLOT = slotOf(NO_GPS_ID);

/** Disarmed, so it reads `nominal` rather than `armed`. */
export const DISARMED_ID = "juliet-10";
export const DISARMED_SLOT = slotOf(DISARMED_ID);

/** Last beacon past the stale horizon, though this node (the ground station)
 * is itself still answering — exactly how a real receiver reports a drone it
 * has stopped hearing. */
export const OFFLINE_ID = "lima-12";
export const OFFLINE_SLOT = slotOf(OFFLINE_ID);

/** The second weak-link drone, so the aggregated weak-RSSI condition count is
 * exactly 2 (`SWARM_WEAK_RSSI_DBM` is -80) together with the offline one. */
export const WEAK_RSSI_ID = "november-14";

export const WEAK_RSSI_BY_SLOT: Readonly<Record<number, number>> = {
  [OFFLINE_SLOT]: -92,
  [slotOf(WEAK_RSSI_ID)]: -84,
};
