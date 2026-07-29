/**
 * @module mock/swarm-fleet
 * @description The demo swarm bus's fixed slot table and per-slot condition
 * constants, split out of `swarm-beacons.ts` to keep both files under the
 * repo's soft LOC target.
 *
 * The slot table is derived from `DEMO_DRONES` rather than hand-duplicated,
 * so the two can never drift: slots 1-13 are exactly the fixture's entries
 * with `hasAgent !== false`, in fixture order. `bravo-2` is excluded on a
 * real rule, not a whim — the swarm bus runs on the companion SBC, and
 * `bravo-2` is the FC-only demo drone with no companion agent.
 *
 * Slot 14 is `whiskey-23`, registered but never beaconing. It is already a
 * WFB-relayed peer in the demo sidebar with a -90 dBm link (see
 * `DemoProvider.tsx`'s `linkedPeers`), so the fleet's one silent slot is the
 * one whose radio was already the weakest — the same drone reads as marginal
 * on both boards.
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

/** Slots 1-13: every demo drone with a companion agent, in fixture order. */
export const BEACON_SLOTS: readonly DemoSwarmSlot[] = DEMO_DRONES.filter(
  (d) => d.hasAgent !== false,
).map((d, i) => ({ slot: i + 1, deviceId: d.id }));

/** Slot 14: registered by the fleet, never beaconing. */
export const SILENT_SLOT: DemoSwarmSlot = { slot: 14, deviceId: "whiskey-23" };

/** The full 14-slot registry: beaconing and silent. */
export const FLEET_SLOTS: readonly DemoSwarmSlot[] = [
  ...BEACON_SLOTS,
  SILENT_SLOT,
];

/** Home position + config lookup for a beaconing slot's device id. */
export const CFG_BY_DEVICE_ID: ReadonlyMap<string, DemoDroneConfig> = new Map(
  DEMO_DRONES.map((d) => [d.id, d]),
);

/** echo-5: emergency bit set, precedence `hard-separation` — the separation
 * layer taking over IS what raises the emergency bit, so the two must agree
 * or the beacon would be incoherent. */
export const EMERGENCY_SLOT = 4;

/** india-9: no GPS fix. */
export const NO_GPS_SLOT = 8;

/** kilo-11: last beacon past the stale horizon, though this node (the ground
 * station) is itself still answering — exactly how a real receiver reports a
 * drone it has stopped hearing. */
export const OFFLINE_SLOT = 10;

/** juliet-10: disarmed, so it reads `nominal` rather than `armed`. */
export const DISARMED_SLOT = 9;

/** The two weak-link slots, so the aggregated weak-RSSI condition count is
 * exactly 2 (`SWARM_WEAK_RSSI_DBM` is -80). */
export const WEAK_RSSI_BY_SLOT: Readonly<Record<number, number>> = {
  [OFFLINE_SLOT]: -92,
  12: -84, // mike-13
};
