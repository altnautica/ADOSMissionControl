/**
 * @license GPL-3.0-only
 *
 * Unit tests for the swarm-neighbours wire mapping — the agent's
 * `GET /api/swarm/neighbors` JSON turned into store rows. The nullable wire
 * fields (`device_id`, `rssi_dbm`) are the ones worth pinning: coercing either
 * to a non-null default would render an unidentified aircraft as named or a
 * missing RSSI as a perfect link.
 */

import { describe, it, expect } from "vitest";

import { parseSwarmNeighbors } from "../swarm-neighbors-client";
import { mergeSnapshots } from "@/components/command/SwarmBeaconBridge";

/** The contract shape, verbatim from the agent route. */
const WIRE = {
  fleet_id: 1,
  slot: 0,
  neighbors: [
    {
      slot: 3,
      device_id: "ados-abc123",
      seq_ms: 41234,
      lat: 12.9716,
      lon: 77.5946,
      alt_m: 32.5,
      vx_ms: 1.2,
      vy_ms: -0.4,
      vz_ms: 0.0,
      heading_deg: 341.6,
      armed: true,
      guided: true,
      emergency: false,
      gps_ok: true,
      hero: false,
      mode_precedence: "formation",
      age_ms: 420,
      rssi_dbm: -48,
    },
  ],
  counters: {
    beacons_tx: 0,
    beacons_rx: 91,
    beacons_bad_magic: 2,
    beacons_bad_tag: 0,
    beacons_stale_dropped: 1,
    neighbors_now: 3,
  },
  slots: [
    { slot: 3, device_id: "ados-abc123" },
    { slot: 9, device_id: null },
  ],
};

describe("parseSwarmNeighbors", () => {
  it("maps the contract shape into a store row", () => {
    const snap = parseSwarmNeighbors(WIRE, 7_000);
    expect(snap).not.toBeNull();
    expect(snap?.fleetId).toBe(1);
    expect(snap?.slot).toBe(0);
    expect(snap?.rows).toEqual([
      {
        slot: 3,
        deviceId: "ados-abc123",
        seqMs: 41234,
        lat: 12.9716,
        lon: 77.5946,
        altM: 32.5,
        vxMs: 1.2,
        vyMs: -0.4,
        vzMs: 0,
        headingDeg: 341.6,
        armed: true,
        guided: true,
        emergency: false,
        gpsOk: true,
        hero: false,
        modePrecedence: "formation",
        ageMs: 420,
        rssiDbm: -48,
        receivedAtMs: 7_000,
      },
    ]);
    expect(snap?.slots).toEqual([
      { slot: 3, deviceId: "ados-abc123" },
      { slot: 9, deviceId: null },
    ]);
  });

  it("passes a null device_id and a null rssi_dbm through as null", () => {
    const snap = parseSwarmNeighbors(
      {
        ...WIRE,
        neighbors: [
          { ...WIRE.neighbors[0], device_id: null, rssi_dbm: null },
        ],
      },
      0,
    );
    expect(snap?.rows[0].deviceId).toBeNull();
    expect(snap?.rows[0].rssiDbm).toBeNull();
  });

  it("keeps heading_deg verbatim rather than re-deriving it from velocity", () => {
    // The agent derives heading as atan2(vy, vx); atan2(-0.4, 1.2) is ~342 deg
    // only by coincidence here, so pin an angle the velocities do NOT imply.
    const snap = parseSwarmNeighbors(
      { ...WIRE, neighbors: [{ ...WIRE.neighbors[0], heading_deg: 12.25 }] },
      0,
    );
    expect(snap?.rows[0].headingDeg).toBe(12.25);
  });

  it("maps the counters block", () => {
    expect(parseSwarmNeighbors(WIRE, 0)?.counters).toEqual({
      beaconsTx: 0,
      beaconsRx: 91,
      beaconsBadMagic: 2,
      beaconsBadTag: 0,
      beaconsStaleDropped: 1,
      neighborsNow: 3,
    });
  });

  it("falls back to hold for an unrecognised mode_precedence", () => {
    const snap = parseSwarmNeighbors(
      { ...WIRE, neighbors: [{ ...WIRE.neighbors[0], mode_precedence: "ludicrous" }] },
      0,
    );
    expect(snap?.rows[0].modePrecedence).toBe("hold");
  });

  it("drops a neighbour with no slot instead of inventing one", () => {
    const snap = parseSwarmNeighbors(
      { ...WIRE, neighbors: [{ device_id: "ados-x" }, WIRE.neighbors[0]] },
      0,
    );
    expect(snap?.rows.map((r) => r.slot)).toEqual([3]);
  });

  it("returns null for a body that is not a swarm reply", () => {
    expect(parseSwarmNeighbors(null, 0)).toBeNull();
    expect(parseSwarmNeighbors("nope", 0)).toBeNull();
    expect(parseSwarmNeighbors({ neighbors: [] }, 0)).toBeNull();
    expect(parseSwarmNeighbors({ fleet_id: 1 }, 0)).toBeNull();
  });

  it("answers with an empty row set for a fleet that is simply silent", () => {
    const snap = parseSwarmNeighbors({ ...WIRE, neighbors: [] }, 0);
    // Distinct from null: the node answered, so the bridge must not back off
    // for a transport reason.
    expect(snap?.fleetId).toBe(1);
    expect(snap?.rows).toEqual([]);
  });

  it("parses the degraded body the route serves when the bus is not running", () => {
    // HTTP 200, well-formed, identity null. Must NOT collapse into the
    // never-answered null, and must never become the config defaults 1/0 —
    // that would make an unprovisioned node indistinguishable from a healthy
    // fleet-1 node that has heard nobody.
    const snap = parseSwarmNeighbors(
      {
        fleet_id: null,
        slot: null,
        neighbors: [],
        counters: {
          beacons_tx: 0,
          beacons_rx: 0,
          beacons_bad_magic: 0,
          beacons_bad_tag: 0,
          beacons_stale_dropped: 0,
          neighbors_now: 0,
        },
      },
      0,
    );
    expect(snap).not.toBeNull();
    expect(snap?.fleetId).toBeNull();
    expect(snap?.slot).toBeNull();
    expect(snap?.rows).toEqual([]);
    expect(snap?.counters.neighborsNow).toBe(0);
  });

  it("never defaults a missing slot to 0, which would claim ground-station identity", () => {
    const doc: Record<string, unknown> = { ...WIRE };
    delete doc.slot;
    expect(parseSwarmNeighbors(doc, 0)?.slot).toBeNull();
  });

  it("parses an old-agent body with no slots key as an empty array, not null", () => {
    const doc: Record<string, unknown> = { ...WIRE };
    delete doc.slots;
    const snap = parseSwarmNeighbors(doc, 0);
    expect(snap).not.toBeNull();
    expect(snap?.slots).toEqual([]);
  });

  it("skips a slot-registry entry with no usable slot and keeps device_id null when absent", () => {
    const snap = parseSwarmNeighbors(
      {
        ...WIRE,
        slots: [{ device_id: "ados-orphan" }, { slot: 5 }],
      },
      0,
    );
    expect(snap?.slots).toEqual([{ slot: 5, deviceId: null }]);
  });
});

describe("mergeSnapshots", () => {
  it("keeps the freshest report of a slot heard by two ground stations", () => {
    const near = parseSwarmNeighbors(
      { ...WIRE, neighbors: [{ ...WIRE.neighbors[0], age_ms: 120, alt_m: 40 }] },
      0,
    );
    const far = parseSwarmNeighbors(
      { ...WIRE, neighbors: [{ ...WIRE.neighbors[0], age_ms: 2600, alt_m: 5 }] },
      0,
    );
    const merged = mergeSnapshots([far!, near!]);
    expect(merged?.rows).toHaveLength(1);
    expect(merged?.rows[0].ageMs).toBe(120);
    expect(merged?.rows[0].altM).toBe(40);
  });

  it("unions slots across receivers", () => {
    const a = parseSwarmNeighbors(WIRE, 0);
    const b = parseSwarmNeighbors(
      { ...WIRE, neighbors: [{ ...WIRE.neighbors[0], slot: 8 }] },
      0,
    );
    expect(mergeSnapshots([a!, b!])?.rows.map((r) => r.slot).sort()).toEqual([
      3, 8,
    ]);
  });

  it("prefers a provisioned snapshot's identity over a bus-down one", () => {
    // A booting receiver answering with fleet_id null must not erase the
    // identity a healthy receiver in the same fleet just reported.
    const busDown = parseSwarmNeighbors(
      { fleet_id: null, slot: null, neighbors: [] },
      0,
    );
    const healthy = parseSwarmNeighbors(WIRE, 0);
    expect(mergeSnapshots([busDown!, healthy!])?.snapshot.fleetId).toBe(1);
  });

  it("reports a null identity when every receiver's bus is down", () => {
    const busDown = parseSwarmNeighbors(
      { fleet_id: null, slot: null, neighbors: [] },
      0,
    );
    expect(mergeSnapshots([busDown!])?.snapshot.fleetId).toBeNull();
  });

  it("returns null when nobody answered", () => {
    expect(mergeSnapshots([])).toBeNull();
  });
});
