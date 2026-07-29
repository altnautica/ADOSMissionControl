/**
 * @module mock/swarm-beacons
 * @description The demo swarm bus: a synthetic `GET /api/swarm/neighbors`
 * payload for `npm run demo`, so the Swarm tab renders a believable 14-slot
 * fleet with no agent attached.
 *
 * This is demo infrastructure, not a stub: it is loaded only when
 * isDemoMode() is true and produces complete, well-formed data.
 *
 * Emits the WIRE payload, not store rows — `demoSwarmNeighborsPayload` returns
 * exactly the agent's contract shape (`fleet_id`, `slot`, `neighbors`,
 * `counters`, `slots`), so `SwarmBeaconBridge` runs it through the real
 * `parseSwarmNeighbors` rather than writing store rows directly. A contract
 * drift then breaks the demo too, instead of the demo silently drifting from
 * what a real agent sends.
 *
 * Positions come from the live demo flight simulation, never a second
 * interpolator — `MockFlightEngine` already writes `fc.position` into the
 * node registry at 200 ms, and this module reads it back, so the Swarm map
 * and the Grid/flight map can never disagree about where a drone is.
 *
 * @license GPL-3.0-only
 */

import {
  SWARM_COMMAND_MODES,
  SWARM_FORMATIONS,
  type SwarmCommandMode,
  type SwarmFormation,
} from "@/lib/swarm/config-keys";
import {
  useNodeRegistryStore,
  resolveNodeId,
} from "@/stores/node-registry";
import type { PositionData } from "@/lib/types/telemetry";
import { getMockConfig } from "./agent/config";
import {
  BEACON_SLOTS,
  CFG_BY_DEVICE_ID,
  DISARMED_SLOT,
  EMERGENCY_SLOT,
  FLEET_SLOTS,
  NO_GPS_SLOT,
  OFFLINE_SLOT,
  WEAK_RSSI_BY_SLOT,
  type DemoSwarmSlot,
} from "./swarm-fleet";
import { formationOffsets, offsetLatLon } from "./swarm-formations";

/** The currently-hero device id. Exclusive by construction — one variable, so
 * two heroes are unrepresentable. Defaults to the leader (slot 1). */
let heroDeviceId: string = BEACON_SLOTS[0].deviceId;

/** Set the demo hero slot. Ignored for a device id outside the beacon table —
 * the real bridge only ever calls this with a slot the board itself rendered. */
export function setDemoSwarmHero(deviceId: string): void {
  if (BEACON_SLOTS.some((s) => s.deviceId === deviceId)) {
    heroDeviceId = deviceId;
  }
}

/** Cumulative bus counters — `beacons_rx` and `beacons_stale_dropped` grow
 * every call, honest for a ground station: it never transmits, so `beacons_tx`
 * stays 0, and the other two are running totals exactly like the real
 * hardware counters they stand in for. */
let cumulativeBeaconsRx = 0;
let cumulativeStaleDropped = 0;

/** A slot's live position from the node registry, or its configured home
 * position at zero velocity on the first tick after mount (before
 * `MockFlightEngine` has written an entry yet). */
function livePosition(deviceId: string): PositionData {
  const entry = useNodeRegistryStore
    .getState()
    .getEntry(resolveNodeId(deviceId));
  if (entry?.fc.position) return entry.fc.position;

  const cfg = CFG_BY_DEVICE_ID.get(deviceId);
  return {
    timestamp: Date.now(),
    lat: cfg?.homeLat ?? 0,
    lon: cfg?.homeLon ?? 0,
    alt: cfg?.homeAlt ?? 0,
    relativeAlt: cfg?.homeAlt ?? 0,
    heading: 0,
    groundSpeed: 0,
    airSpeed: 0,
    climbRate: 0,
  };
}

/**
 * Every beaconing slot's position for the active mode, read fresh each call
 * from the flight simulation so the fleet moves with the demo's own drones.
 *
 *   - hold: each slot at its own live position.
 *   - formation: the leader (slot 1) at its live position; every other slot
 *     placed by `formationOffsets` + `offsetLatLon` around it, carrying the
 *     leader's velocity — station keeping, so the lattice translates as the
 *     leader flies its path.
 *   - flocking: each slot's own live position lerped 60% toward the
 *     leader's, keeping its own velocity — a loose cluster, not a lattice.
 */
function resolvePositions(
  mode: SwarmCommandMode,
  formation: SwarmFormation,
  spacingM: number,
): Map<number, PositionData> {
  const positions = new Map<number, PositionData>();

  if (mode === "hold") {
    for (const slot of BEACON_SLOTS) {
      positions.set(slot.slot, livePosition(slot.deviceId));
    }
    return positions;
  }

  const leader = BEACON_SLOTS[0];
  const leaderPos = livePosition(leader.deviceId);
  positions.set(leader.slot, leaderPos);

  if (mode === "formation") {
    const offsets = formationOffsets(formation, BEACON_SLOTS.length, spacingM);
    for (let i = 1; i < BEACON_SLOTS.length; i++) {
      const slot = BEACON_SLOTS[i];
      const { rightM, backM } = offsets[i];
      const { lat, lon } = offsetLatLon(
        leaderPos.lat,
        leaderPos.lon,
        leaderPos.heading,
        rightM,
        backM,
      );
      positions.set(slot.slot, {
        timestamp: leaderPos.timestamp,
        lat,
        lon,
        alt: leaderPos.alt,
        relativeAlt: leaderPos.relativeAlt,
        heading: leaderPos.heading,
        groundSpeed: leaderPos.groundSpeed,
        airSpeed: leaderPos.airSpeed,
        climbRate: leaderPos.climbRate,
      });
    }
    return positions;
  }

  // flocking
  const LERP_TOWARD_LEADER = 0.6;
  for (let i = 1; i < BEACON_SLOTS.length; i++) {
    const slot = BEACON_SLOTS[i];
    const own = livePosition(slot.deviceId);
    positions.set(slot.slot, {
      timestamp: own.timestamp,
      lat: own.lat + LERP_TOWARD_LEADER * (leaderPos.lat - own.lat),
      lon: own.lon + LERP_TOWARD_LEADER * (leaderPos.lon - own.lon),
      alt: own.alt + LERP_TOWARD_LEADER * (leaderPos.alt - own.alt),
      relativeAlt: own.relativeAlt,
      heading: own.heading,
      groundSpeed: own.groundSpeed,
      airSpeed: own.airSpeed,
      climbRate: own.climbRate,
    });
  }
  return positions;
}

/** NED velocity components from a position sample's heading + rates. `vz` is
 * positive DESCENDING on the wire, while `climbRate` is positive climbing —
 * negate once, here. */
function nedVelocity(pos: PositionData): { vx: number; vy: number; vz: number } {
  const headingRad = (pos.heading * Math.PI) / 180;
  return {
    vx: pos.groundSpeed * Math.cos(headingRad),
    vy: pos.groundSpeed * Math.sin(headingRad),
    vz: -pos.climbRate,
  };
}

/** One beaconing slot's wire row. Conditions are fixed by slot number (see
 * `swarm-fleet.ts`), not derived from `position`, so the exception set is
 * identical on every load regardless of where the simulation has flown. */
function buildNeighborRow(
  entry: DemoSwarmSlot,
  position: PositionData,
  nowMs: number,
  mode: SwarmCommandMode,
): Record<string, unknown> {
  const { slot, deviceId } = entry;
  const armed = slot !== DISARMED_SLOT;
  const emergency = slot === EMERGENCY_SLOT;
  const gpsOk = slot !== NO_GPS_SLOT;
  // Guided reflects the FC's own mode, not the arbitration precedence below —
  // an armed, commanded member flies GUIDED whenever the operator has picked
  // anything but hold.
  const guided = armed && mode !== "hold";
  const modePrecedence =
    slot === EMERGENCY_SLOT ? "hard-separation" : slot === DISARMED_SLOT ? "hold" : mode;
  const ageMs = slot === OFFLINE_SLOT ? 4200 : 120 + ((slot * 37) % 300);
  const rssiDbm = WEAK_RSSI_BY_SLOT[slot] ?? -45 - ((slot * 7) % 26);
  const { vx, vy, vz } = nedVelocity(position);

  return {
    slot,
    device_id: deviceId,
    seq_ms: (slot * 1000 + nowMs) % 65536,
    lat: position.lat,
    lon: position.lon,
    alt_m: position.alt,
    vx_ms: vx,
    vy_ms: vy,
    vz_ms: vz,
    heading_deg: position.heading,
    armed,
    guided,
    emergency,
    gps_ok: gpsOk,
    hero: deviceId === heroDeviceId,
    mode_precedence: modePrecedence,
    age_ms: ageMs,
    rssi_dbm: rssiDbm,
  };
}

/** The exact `GET /api/swarm/neighbors` contract shape — see
 * `ados-swarmbus/src/publish.rs`'s `NEIGHBOR_KEYS` / `SLOT_KEYS`. Reported by
 * this node acting as the ground station: `fleet_id: 1`, `slot: 0`. */
export function demoSwarmNeighborsPayload(nowMs: number): Record<string, unknown> {
  const config = getMockConfig();
  const swarm = (config.swarm ?? {}) as {
    mode?: unknown;
    default_formation?: unknown;
    default_spacing?: unknown;
  };

  const mode: SwarmCommandMode = (
    SWARM_COMMAND_MODES as readonly unknown[]
  ).includes(swarm.mode)
    ? (swarm.mode as SwarmCommandMode)
    : "hold";
  const formation: SwarmFormation = (
    SWARM_FORMATIONS as readonly unknown[]
  ).includes(swarm.default_formation)
    ? (swarm.default_formation as SwarmFormation)
    : "column";
  const spacingM =
    typeof swarm.default_spacing === "number" ? swarm.default_spacing : 25;

  const positions = resolvePositions(mode, formation, spacingM);
  const neighbors = BEACON_SLOTS.map((slot) =>
    buildNeighborRow(slot, positions.get(slot.slot)!, nowMs, mode),
  );

  cumulativeBeaconsRx += BEACON_SLOTS.length;
  cumulativeStaleDropped += 1; // the OFFLINE_SLOT beacon is stale every call

  return {
    fleet_id: 1,
    slot: 0,
    neighbors,
    counters: {
      beacons_tx: 0,
      beacons_rx: cumulativeBeaconsRx,
      beacons_bad_magic: 0,
      beacons_bad_tag: 0,
      beacons_stale_dropped: cumulativeStaleDropped,
      neighbors_now: BEACON_SLOTS.length,
    },
    slots: FLEET_SLOTS.map((s) => ({ slot: s.slot, device_id: s.deviceId })),
  };
}
