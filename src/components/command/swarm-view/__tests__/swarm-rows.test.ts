/**
 * @module command/swarm-view/swarm-rows.test
 * @description The swarm board's attention rules.
 *
 * Two properties decide whether an operator can hold twenty-four aircraft: the
 * worst slot must reach the top of the table, and a summary chip's number must
 * be exactly the set of rows that chip filters to. Both are pure, and both are
 * the kind of thing that silently degrades — a precedence reordered "harmlessly"
 * buries an emergency under a GPS warning — so they are pinned here.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import {
  SWARM_BEACON_STALE_MS,
  type SwarmBeaconRow,
  type SwarmFleetSlot,
} from "@/stores/swarm-beacon-store";
import {
  buildSwarmSlotRows,
  matchesSeverityFilter,
  sortSwarmRowsUnhealthyFirst,
  swarmConditionCounts,
  swarmHeadingDeg,
  swarmRowSeverity,
  swarmSeverityCounts,
  type SwarmSlotRow,
} from "../swarm-rows";

const NO_NODES: ReadonlyMap<number, FleetNodeEntry> = new Map();
const NO_SUMMARIES: ReadonlyMap<string, CommandAgentSummary> = new Map();
const NO_REGISTERED: readonly SwarmFleetSlot[] = [];

function beacon(slot: number, over: Partial<SwarmBeaconRow> = {}): SwarmBeaconRow {
  return {
    slot,
    deviceId: `ados-${slot}`,
    seqMs: 0,
    lat: 12.9716,
    lon: 77.5946,
    altM: 30,
    vxMs: 0,
    vyMs: 0,
    vzMs: 0,
    headingDeg: 0,
    armed: false,
    guided: false,
    emergency: false,
    gpsOk: true,
    hero: false,
    modePrecedence: "hold",
    ageMs: 120,
    rssiDbm: -48,
    receivedAtMs: 1_000,
    ...over,
  };
}

/** A row carrying only what the pure helpers read. */
function row(slot: number, over: Partial<SwarmBeaconRow> | null): SwarmSlotRow {
  const b = over === null ? null : beacon(slot, over);
  return {
    slot,
    beacon: b,
    node: null,
    summary: null,
    severity: swarmRowSeverity(b),
  };
}

describe("swarmRowSeverity", () => {
  it("classifies a slot with no beacon at all as the settled loss", () => {
    expect(swarmRowSeverity(null)).toBe("noBeacon");
  });

  it("distrusts every bit under a stale beacon", () => {
    // Emergency AND no GPS AND armed — none of it counts, because a reading
    // this old is a claim about the past, not the aircraft's state now.
    const stale = beacon(3, {
      ageMs: SWARM_BEACON_STALE_MS,
      emergency: true,
      gpsOk: false,
      armed: true,
    });
    expect(swarmRowSeverity(stale)).toBe("offline");
  });

  it("keeps a beacon one millisecond inside the horizon trustworthy", () => {
    const fresh = beacon(3, {
      ageMs: SWARM_BEACON_STALE_MS - 1,
      emergency: true,
    });
    expect(swarmRowSeverity(fresh)).toBe("error");
  });

  it("ranks emergency over a lost fix over merely being armed", () => {
    expect(
      swarmRowSeverity(beacon(1, { emergency: true, gpsOk: false, armed: true })),
    ).toBe("error");
    expect(swarmRowSeverity(beacon(1, { gpsOk: false, armed: true }))).toBe(
      "warning",
    );
    expect(swarmRowSeverity(beacon(1, { armed: true }))).toBe("armed");
    expect(swarmRowSeverity(beacon(1))).toBe("nominal");
  });
});

describe("sortSwarmRowsUnhealthyFirst", () => {
  it("floats every exception above the healthy tail", () => {
    const rows = [
      row(1, {}), // nominal
      row(2, { armed: true }),
      row(3, { gpsOk: false }),
      row(4, { emergency: true }),
      row(5, { ageMs: SWARM_BEACON_STALE_MS + 500 }),
      row(6, null), // no beacon
    ];
    expect(sortSwarmRowsUnhealthyFirst(rows).map((r) => r.slot)).toEqual([
      6, 5, 4, 3, 2, 1,
    ]);
  });

  it("holds the healthy tail still by ordering equals on slot", () => {
    // Twenty quiet rows must not reshuffle under the cursor: an operator stops
    // reading a block that moves, which is the failure this ordering prevents.
    const rows = [row(9, {}), row(2, {}), row(24, {}), row(7, {})];
    expect(sortSwarmRowsUnhealthyFirst(rows).map((r) => r.slot)).toEqual([
      2, 7, 9, 24,
    ]);
  });

  it("does not mutate the array it was handed", () => {
    const rows = [row(2, {}), row(1, { emergency: true })];
    sortSwarmRowsUnhealthyFirst(rows);
    expect(rows.map((r) => r.slot)).toEqual([2, 1]);
  });
});

describe("swarmSeverityCounts and the chip filter", () => {
  const rows = [
    row(1, {}),
    row(2, {}),
    row(3, { armed: true }),
    row(4, { gpsOk: false }),
    row(5, { emergency: true }),
    row(6, { ageMs: SWARM_BEACON_STALE_MS + 10 }),
    row(7, null),
  ];

  it("counts each slot exactly once and leaves the healthy uncounted", () => {
    expect(swarmSeverityCounts(rows)).toEqual({
      noBeacon: 1,
      offline: 1,
      error: 1,
      warning: 1,
      armed: 1,
    });
  });

  it("makes every chip's number the row set that chip filters to", () => {
    // The chip IS the way into its rows, so a count the filter cannot reproduce
    // sends the operator hunting for drones that are not there.
    for (const [id, count] of Object.entries(swarmSeverityCounts(rows))) {
      const filtered = rows.filter((r) =>
        matchesSeverityFilter(
          id as keyof ReturnType<typeof swarmSeverityCounts>,
          r.severity,
        ),
      );
      expect(filtered.length, `chip ${id}`).toBe(count);
    }
  });

  it("shows every row when no chip is active", () => {
    expect(rows.filter((r) => matchesSeverityFilter(null, r.severity))).toHaveLength(
      rows.length,
    );
  });
});

describe("buildSwarmSlotRows", () => {
  it("unions registered slots with beaconing ones so neither can hide", () => {
    const node = { deviceId: "ados-9", name: "Nine" } as FleetNodeEntry;
    const rows = buildSwarmSlotRows(
      [beacon(3)],
      [{ slot: 9, deviceId: "ados-9" }],
      new Map([[9, node]]),
      NO_SUMMARIES,
    );
    const bySlot = new Map(rows.map((r) => [r.slot, r]));
    // Slot 9 is registered and silent; slot 3 is beaconing and unregistered.
    expect(bySlot.get(9)?.severity).toBe("noBeacon");
    expect(bySlot.get(3)?.beacon?.deviceId).toBe("ados-3");
    expect(bySlot.get(3)?.node).toBeNull();
  });

  it("joins telemetry through the node's device id, not the beacon's slot", () => {
    const node = { deviceId: "fc-77", name: "Seven" } as FleetNodeEntry;
    const summary = { identity: { deviceId: "fc-77" } } as CommandAgentSummary;
    const rows = buildSwarmSlotRows(
      [beacon(4, { deviceId: null })],
      [],
      new Map([[4, node]]),
      new Map([["fc-77", summary]]),
    );
    expect(rows[0].summary).toBe(summary);
  });

  it("returns nothing when neither source has a slot", () => {
    expect(
      buildSwarmSlotRows([], NO_REGISTERED, NO_NODES, NO_SUMMARIES),
    ).toEqual([]);
  });

  it("renders a registered slot with no beacon and no paired node as one noBeacon row named by its registry device id", () => {
    const rows = buildSwarmSlotRows(
      [],
      [{ slot: 14, deviceId: "whiskey-23" }],
      NO_NODES,
      NO_SUMMARIES,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slot: 14,
      beacon: null,
      node: null,
      severity: "noBeacon",
    });
  });

  it("falls back to the registry's device id for the summary lookup when no beacon or node names one", () => {
    const summary = {
      identity: { deviceId: "whiskey-23" },
    } as CommandAgentSummary;
    const rows = buildSwarmSlotRows(
      [],
      [{ slot: 14, deviceId: "whiskey-23" }],
      NO_NODES,
      new Map([["whiskey-23", summary]]),
    );
    expect(rows[0].summary).toBe(summary);
  });
});

describe("swarmHeadingDeg", () => {
  it("derives the track angle from velocity while the drone is moving", () => {
    // Due east in NED: vx (north) 0, vy (east) 4 -> 90 degrees.
    expect(swarmHeadingDeg(beacon(1, { vxMs: 0, vyMs: 4 }))).toBeCloseTo(90, 6);
    // Due south-west: atan2(-3, -3) -> 225 after normalisation.
    expect(swarmHeadingDeg(beacon(1, { vxMs: -3, vyMs: -3 }))).toBeCloseTo(225, 6);
  });

  it("falls back to the reported heading below the speed floor", () => {
    // A hovering drone's velocity is noise; deriving from it spins the arrow.
    const hovering = beacon(1, { vxMs: 0.1, vyMs: -0.1, headingDeg: 341.6 });
    expect(swarmHeadingDeg(hovering)).toBeCloseTo(341.6, 6);
  });

  it("normalises a wrapped or negative reported heading into 0..360", () => {
    expect(swarmHeadingDeg(beacon(1, { headingDeg: -90 }))).toBe(270);
    expect(swarmHeadingDeg(beacon(1, { headingDeg: 450 }))).toBe(90);
  });
});

describe("swarmConditionCounts", () => {
  const thresholds = { warningPct: 30, criticalPct: 15 };

  function withBattery(slot: number, remaining: number | null): SwarmSlotRow {
    return {
      ...row(slot, {}),
      summary: {
        telemetry: { batteryRemaining: remaining },
      } as CommandAgentSummary,
    };
  }

  it("aggregates each condition into one number, never one per drone", () => {
    const rows = [
      withBattery(1, 12),
      withBattery(2, 25),
      withBattery(3, 80),
      withBattery(4, null),
      { ...row(5, { modePrecedence: "hard-separation" }) },
      { ...row(6, { rssiDbm: -84 }) },
      { ...row(7, { rssiDbm: -40 }) },
    ];
    expect(swarmConditionCounts(rows, thresholds)).toEqual({
      lowBattery: 2,
      hardSeparation: 1,
      weakLink: 1,
    });
  });

  it("never counts an absent reading as a low battery or a weak link", () => {
    const rows = [withBattery(1, null), row(2, { rssiDbm: null })];
    expect(swarmConditionCounts(rows, thresholds)).toEqual({
      lowBattery: 0,
      hardSeparation: 0,
      weakLink: 0,
    });
  });
});
