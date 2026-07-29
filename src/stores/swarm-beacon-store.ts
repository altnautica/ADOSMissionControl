"use client";

/**
 * @module SwarmBeaconStore
 * @description Live fleet-slot beacon state for the Swarm tab.
 *
 * `slot` is a fleet-addressing concept that exists nowhere else in the GCS —
 * the other "slot" words in this repo are recorder slots, cockpit hotbar slots
 * and plugin panel slots, none of them fleet identity. So this is a new store
 * rather than a widened `FleetDrone` / `NodeEntry`: the slot -> deviceId join
 * lives HERE, and the node registry stays keyed by `node:<deviceId>` as before.
 *
 * Shape copies `command-fleet-store`'s `telemetryByDeviceId` map: one flat
 * global record with an upsert-merge writer, fed by exactly one bridge
 * (`SwarmBeaconBridge`, polling the ground station's `GET /api/swarm/neighbors`
 * at 2 Hz).
 *
 * Deliberately NOT persisted. A beacon is live state with a 3 s shelf life;
 * rehydrating one from localStorage would render a drone's last known position
 * as if it were current, which is the exact failure Rule 44 exists to prevent.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/**
 * Which layer of the onboard arbitration stack is ACTUALLY governing the
 * aircraft right now — not what the operator commanded. A drone whose
 * separation layer has taken over reads `hard-separation` even while a
 * formation is commanded.
 *
 * `"hold"` until the onboard autonomy ships; the agent reports it verbatim.
 */
export type SwarmModePrecedence =
  | "hard-separation"
  | "operator"
  | "formation"
  | "flocking"
  | "hold";

/** One fleet slot's decoded beacon, as the Swarm surfaces consume it. */
export interface SwarmBeaconRow {
  /** Fleet slot, 1..=24. Slot 0 is the ground station and never beacons. */
  slot: number;
  /** The agent device id occupying this slot, or null when the ground
   * station could not join the slot to a known device. */
  deviceId: string | null;
  /** Sender uptime milliseconds (16-bit, wraps) — the beacon's own epoch. */
  seqMs: number;
  lat: number;
  lon: number;
  altM: number;
  vxMs: number;
  vyMs: number;
  vzMs: number;
  /** Course over ground in degrees, derived agent-side as `atan2(vy, vx)`.
   * Heading is not transmitted in the 20-byte beacon. */
  headingDeg: number;
  armed: boolean;
  guided: boolean;
  emergency: boolean;
  gpsOk: boolean;
  /** True when this slot is the operator-selected full-rate video source. */
  hero: boolean;
  modePrecedence: SwarmModePrecedence;
  /** Agent-computed age of the beacon at the moment the snapshot was built. */
  ageMs: number;
  /** Radiotap RSSI of the frame that carried the beacon; null when the
   * capture gave none. */
  rssiDbm: number | null;
  /** GCS wall clock when this row was written, for `dropStale`. */
  receivedAtMs: number;
}

/** One slot in the ground station's fleet registry: issued, whether or not
 * it is currently beaconing. Distinct from `SwarmBeaconRow` (a live
 * observation) — this is a registry fact with no shelf life. */
export interface SwarmFleetSlot {
  slot: number;
  deviceId: string | null;
}

/** Bus counters the agent reports beside the neighbour table. */
export interface SwarmBeaconCounters {
  beaconsTx: number;
  beaconsRx: number;
  beaconsBadMagic: number;
  beaconsBadTag: number;
  beaconsStaleDropped: number;
  neighborsNow: number;
}

export interface SwarmBeaconState {
  /** Live rows keyed by fleet slot. */
  bySlot: Record<number, SwarmBeaconRow>;
  /** Fleet the reporting ground station belongs to; null before first poll. */
  fleetId: number | null;
  counters: SwarmBeaconCounters | null;
  lastUpdatedMs: number | null;
  /** The ground station's registered-slot table, keyed by slot: every slot
   * the fleet has issued, whether or not it is currently beaconing. */
  registeredBySlot: Record<number, SwarmFleetSlot>;
  /** Merge a poll's rows by slot. A slot absent from `rows` is left alone —
   * removal is `dropStale`'s job, so one dropped poll never blanks the board.
   * `registered` REPLACES `registeredBySlot` wholesale instead — a beacon is
   * a transient observation, so a dropped poll must not blank it, but the
   * registry is an authoritative document, so a slot's absence means it was
   * released, and holding a stale copy would show a drone that has been
   * unpaired. */
  upsertBeacons: (
    rows: SwarmBeaconRow[],
    fleetId: number,
    counters: SwarmBeaconCounters,
    registered: readonly SwarmFleetSlot[],
  ) => void;
  /** Evict rows at or past the stale horizon. Never touches
   * `registeredBySlot` — a registered slot is a registry fact with no shelf
   * life; being silent is what makes it a `noBeacon` row. */
  dropStale: (nowMs: number, staleMs: number) => void;
  clear: () => void;
}

/**
 * Six missed beacons at the 2 Hz bus rate. Matches the agent's own
 * `NEIGHBOR_STALE`, so the GCS and the drones agree on when a neighbour is
 * gone rather than the UI inventing a second, softer definition.
 */
export const SWARM_BEACON_STALE_MS = 3000;

export const useSwarmBeaconStore = create<SwarmBeaconState>((set) => ({
  bySlot: {},
  fleetId: null,
  counters: null,
  lastUpdatedMs: null,
  registeredBySlot: {},

  upsertBeacons(rows, fleetId, counters, registered) {
    set((state) => ({
      bySlot:
        rows.length === 0
          ? state.bySlot
          : {
              ...state.bySlot,
              ...Object.fromEntries(rows.map((row) => [row.slot, row])),
            },
      fleetId,
      counters,
      lastUpdatedMs: rows.length > 0 ? rows[0].receivedAtMs : Date.now(),
      registeredBySlot: Object.fromEntries(
        registered.map((slot) => [slot.slot, slot]),
      ),
    }));
  },

  dropStale(nowMs, staleMs) {
    set((state) => {
      const next: Record<number, SwarmBeaconRow> = {};
      let dropped = false;
      for (const [key, row] of Object.entries(state.bySlot)) {
        if (nowMs - row.receivedAtMs >= staleMs) {
          dropped = true;
          continue;
        }
        next[Number(key)] = row;
      }
      return dropped ? { bySlot: next } : state;
    });
  },

  clear() {
    set({
      bySlot: {},
      fleetId: null,
      counters: null,
      lastUpdatedMs: null,
      registeredBySlot: {},
    });
  },
}));

// ---------------------------------------------------------------------------
// Selectors
//
// Exported as named functions so a consumer never subscribes to the whole
// store with a bare `useSwarmBeaconStore()` — at 2 Hz that would re-render
// every Swarm surface on every poll regardless of what actually changed.
//
// Severity classification deliberately does NOT live here. It needs the
// registered-slot join to answer "no beacon" honestly, which the store cannot
// see, so the one rule lives beside that join in
// `command/swarm-view/swarm-rows.ts` (`swarmRowSeverity`). A second copy here
// that agreed today would only be a second copy free to drift tomorrow.
// ---------------------------------------------------------------------------

let rowsCacheKey: Record<number, SwarmBeaconRow> | null = null;
let rowsCacheValue: SwarmBeaconRow[] = [];

/** Every live row, ascending by slot. Referentially stable between writes. */
export function selectSwarmRows(state: SwarmBeaconState): SwarmBeaconRow[] {
  if (rowsCacheKey === state.bySlot) return rowsCacheValue;
  rowsCacheKey = state.bySlot;
  rowsCacheValue = Object.values(state.bySlot).sort((a, b) => a.slot - b.slot);
  return rowsCacheValue;
}

/**
 * One slot's row, or undefined.
 * Usage: `useSwarmBeaconStore(selectSwarmRowBySlot(3))`.
 */
export function selectSwarmRowBySlot(slot: number) {
  return (state: SwarmBeaconState): SwarmBeaconRow | undefined =>
    state.bySlot[slot];
}

let fleetSlotsCacheKey: Record<number, SwarmFleetSlot> | null = null;
let fleetSlotsCacheValue: SwarmFleetSlot[] = [];

/**
 * Every registered slot, ascending by slot. Referentially stable between
 * writes — same pattern as `selectSwarmRows`, for the same reason: a
 * consumer subscribing to this at 2 Hz must not re-render when the registry
 * has not actually changed.
 */
export function selectSwarmFleetSlots(
  state: SwarmBeaconState,
): SwarmFleetSlot[] {
  if (fleetSlotsCacheKey === state.registeredBySlot) return fleetSlotsCacheValue;
  fleetSlotsCacheKey = state.registeredBySlot;
  fleetSlotsCacheValue = Object.values(state.registeredBySlot).sort(
    (a, b) => a.slot - b.slot,
  );
  return fleetSlotsCacheValue;
}
