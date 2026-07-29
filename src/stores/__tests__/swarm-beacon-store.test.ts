/**
 * @license GPL-3.0-only
 *
 * Unit tests for the swarm beacon store: slot-keyed upsert merging, the stale
 * eviction that keeps a dead aircraft off the board, and the referential
 * stability the 2 Hz selectors depend on. Severity classification is tested
 * beside its one implementation in `command/swarm-view/swarm-rows.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  useSwarmBeaconStore,
  selectSwarmRows,
  selectSwarmRowBySlot,
  selectSwarmFleetSlots,
  SWARM_BEACON_STALE_MS,
  type SwarmBeaconCounters,
  type SwarmBeaconRow,
  type SwarmFleetSlot,
} from "../swarm-beacon-store";

const COUNTERS: SwarmBeaconCounters = {
  beaconsTx: 0,
  beaconsRx: 12,
  beaconsBadMagic: 0,
  beaconsBadTag: 0,
  beaconsStaleDropped: 0,
  neighborsNow: 1,
};

function slotEntry(slot: number, deviceId: string | null): SwarmFleetSlot {
  return { slot, deviceId };
}

function row(slot: number, over: Partial<SwarmBeaconRow> = {}): SwarmBeaconRow {
  return {
    slot,
    deviceId: `ados-${slot}`,
    seqMs: 41234,
    lat: 12.9716,
    lon: 77.5946,
    altM: 32.5,
    vxMs: 1.2,
    vyMs: -0.4,
    vzMs: 0,
    headingDeg: 341.6,
    armed: false,
    guided: false,
    emergency: false,
    gpsOk: true,
    hero: false,
    modePrecedence: "hold",
    ageMs: 100,
    rssiDbm: -48,
    receivedAtMs: 10_000,
    ...over,
  };
}

beforeEach(() => {
  useSwarmBeaconStore.getState().clear();
});

describe("upsertBeacons", () => {
  it("merges by slot, replacing a slot's row and leaving other slots intact", () => {
    const store = useSwarmBeaconStore.getState();
    store.upsertBeacons([row(3), row(7)], 1, COUNTERS, []);
    store.upsertBeacons([row(3, { armed: true, altM: 90 })], 1, COUNTERS, []);

    const state = useSwarmBeaconStore.getState();
    expect(Object.keys(state.bySlot).sort()).toEqual(["3", "7"]);
    expect(state.bySlot[3].armed).toBe(true);
    expect(state.bySlot[3].altM).toBe(90);
    // Slot 7 was absent from the second poll and must survive — removal is
    // dropStale's job, so one dropped poll never blanks the board.
    expect(state.bySlot[7].armed).toBe(false);
  });

  it("records fleet id, counters and the write timestamp", () => {
    useSwarmBeaconStore
      .getState()
      .upsertBeacons([row(2, { receivedAtMs: 5_555 })], 9, COUNTERS, []);

    const state = useSwarmBeaconStore.getState();
    expect(state.fleetId).toBe(9);
    expect(state.counters).toEqual(COUNTERS);
    expect(state.lastUpdatedMs).toBe(5_555);
  });

  it("selectSwarmRows orders by slot and is referentially stable between writes", () => {
    useSwarmBeaconStore
      .getState()
      .upsertBeacons([row(9), row(2)], 1, COUNTERS, []);

    const first = selectSwarmRows(useSwarmBeaconStore.getState());
    expect(first.map((r) => r.slot)).toEqual([2, 9]);
    // A stable reference is load-bearing: zustand v5 re-renders every Swarm
    // surface at 2 Hz if this selector returns a new array each read.
    expect(selectSwarmRows(useSwarmBeaconStore.getState())).toBe(first);
  });

  it("selectSwarmRowBySlot reads one slot and misses cleanly", () => {
    useSwarmBeaconStore.getState().upsertBeacons([row(4)], 1, COUNTERS, []);
    const state = useSwarmBeaconStore.getState();
    expect(selectSwarmRowBySlot(4)(state)?.deviceId).toBe("ados-4");
    expect(selectSwarmRowBySlot(5)(state)).toBeUndefined();
  });

  it("replaces the registered-slot table wholesale, dropping a released slot", () => {
    const store = useSwarmBeaconStore.getState();
    store.upsertBeacons([], 1, COUNTERS, [
      slotEntry(1, "ados-1"),
      slotEntry(2, "ados-2"),
    ]);
    expect(useSwarmBeaconStore.getState().registeredBySlot).toEqual({
      1: slotEntry(1, "ados-1"),
      2: slotEntry(2, "ados-2"),
    });

    // Slot 2 released on the next registry write — unlike the beacon merge
    // above, its absence must clear it, not leave a stale copy of a drone
    // that has been unpaired.
    store.upsertBeacons([], 1, COUNTERS, [slotEntry(1, "ados-1")]);
    expect(useSwarmBeaconStore.getState().registeredBySlot).toEqual({
      1: slotEntry(1, "ados-1"),
    });
  });

  it("selectSwarmFleetSlots orders by slot and is referentially stable between writes", () => {
    useSwarmBeaconStore
      .getState()
      .upsertBeacons([], 1, COUNTERS, [
        slotEntry(9, "ados-9"),
        slotEntry(2, "ados-2"),
      ]);

    const first = selectSwarmFleetSlots(useSwarmBeaconStore.getState());
    expect(first.map((s) => s.slot)).toEqual([2, 9]);
    expect(selectSwarmFleetSlots(useSwarmBeaconStore.getState())).toBe(first);
  });
});

describe("dropStale", () => {
  it("evicts rows at or past the stale horizon and keeps fresher ones", () => {
    useSwarmBeaconStore.getState().upsertBeacons(
      [
        row(1, { receivedAtMs: 10_000 }), // exactly stale at the horizon
        row(2, { receivedAtMs: 10_001 }), // one ms inside it
        row(3, { receivedAtMs: 5_000 }), // long gone
      ],
      1,
      COUNTERS,
      [],
    );

    useSwarmBeaconStore
      .getState()
      .dropStale(10_000 + SWARM_BEACON_STALE_MS, SWARM_BEACON_STALE_MS);

    expect(Object.keys(useSwarmBeaconStore.getState().bySlot)).toEqual(["2"]);
  });

  it("leaves the map reference untouched when nothing expired", () => {
    useSwarmBeaconStore.getState().upsertBeacons([row(1)], 1, COUNTERS, []);
    const before = useSwarmBeaconStore.getState().bySlot;
    useSwarmBeaconStore.getState().dropStale(10_100, SWARM_BEACON_STALE_MS);
    expect(useSwarmBeaconStore.getState().bySlot).toBe(before);
  });

  it("evicts a stale beacon while leaving registeredBySlot intact — a registry fact has no shelf life", () => {
    useSwarmBeaconStore
      .getState()
      .upsertBeacons(
        [row(1, { receivedAtMs: 5_000 })],
        1,
        COUNTERS,
        [slotEntry(1, "ados-1")],
      );
    useSwarmBeaconStore
      .getState()
      .dropStale(5_000 + SWARM_BEACON_STALE_MS, SWARM_BEACON_STALE_MS);

    const state = useSwarmBeaconStore.getState();
    expect(state.bySlot).toEqual({});
    expect(state.registeredBySlot).toEqual({ 1: slotEntry(1, "ados-1") });
  });
});

describe("clear", () => {
  it("empties rows, fleet id, counters, the timestamp and the registry", () => {
    useSwarmBeaconStore
      .getState()
      .upsertBeacons([row(1), row(2)], 4, COUNTERS, [slotEntry(1, "ados-1")]);
    useSwarmBeaconStore.getState().clear();

    const state = useSwarmBeaconStore.getState();
    expect(state.bySlot).toEqual({});
    expect(state.fleetId).toBeNull();
    expect(state.counters).toBeNull();
    expect(state.lastUpdatedMs).toBeNull();
    expect(state.registeredBySlot).toEqual({});
    expect(selectSwarmRows(state)).toEqual([]);
  });
});
