/**
 * @module command/swarm-view/swarm-rows
 * @description The swarm board's row model, its severity vocabulary, and the
 * exception ordering every band reads.
 *
 * Twenty-four rows of green are as unreadable as twenty-four rows of red, so
 * the board never presents the fleet flat. One severity is resolved per slot —
 * disjointly, worst first — and everything above the table (the summary chips,
 * the row order, the map tint) is a projection of that single decision. A
 * healthy disarmed drone lands in no chip and sorts last: it is meant to
 * disappear.
 *
 * A slot the ground station has registered but has heard no beacon from is the
 * loudest row on the board, so it is modelled here rather than being an absence
 * the table happens not to draw.
 *
 * Pure — no store reads, no hooks. Ordering and counts are what an operator's
 * attention is actually spent on, so both are provable without mounting.
 *
 * @license GPL-3.0-only
 */

import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { batteryBand, type BatteryThresholds } from "@/lib/battery-bands";
import type { StatusLevel } from "@/components/ui/status-dot";
import type { ReadingFreshness } from "@/components/command/nodes-view/cell-primitives";
import {
  SWARM_BEACON_STALE_MS,
  type SwarmBeaconRow,
} from "@/stores/swarm-beacon-store";

/**
 * One slot's worst current condition. Disjoint by construction: a drone that
 * has declared an emergency AND lost GPS is one `error`, never two alarms.
 *
 * The precedence below is the store's own (`selectSwarmSeverityCounts`), not a
 * second opinion. Trustworthiness comes first: a beacon past the stale horizon
 * makes every bit under it unreliable, so `offline` outranks the emergency flag
 * rather than the other way round — an emergency bit that is four seconds old
 * is a claim about the past. The summary chips and this row order must never
 * disagree, so there is exactly one rule and both read it.
 */
export type SwarmSeverity =
  | "noBeacon" // an expected slot with no row at all — the settled loss
  | "offline" // last beacon at or past the stale horizon; nothing below is trusted
  | "error" // emergency bit set
  | "warning" // flying without a usable GPS fix
  | "armed" // armed and otherwise nominal — hot, not wrong
  | "nominal"; // disarmed and healthy: the quiet majority

/**
 * The five the summary strip offers as filters. `nominal` is deliberately not
 * one — no operator task begins "show me the healthy ones".
 */
export type SwarmSeverityId = Exclude<SwarmSeverity, "nominal">;

/** Worst first. Row order, chip order and tiebreaks all read this one array. */
export const SWARM_SEVERITY_ORDER: readonly SwarmSeverity[] = [
  "noBeacon",
  "offline",
  "error",
  "warning",
  "armed",
  "nominal",
];

/**
 * Chip order: the four exceptions in severity order, then `armed` last. Armed
 * is not a fault — it is the "how much of the fleet is hot" context an operator
 * reads after the exceptions, so it sits on the far side of the divider.
 */
export const SWARM_SEVERITY_IDS: readonly SwarmSeverityId[] = [
  "noBeacon",
  "offline",
  "error",
  "warning",
  "armed",
];

/**
 * Severity to the shared health vocabulary. `armed` takes the success tone
 * because an armed drone doing what it was told is not a problem; only the four
 * exceptions above it spend a severity colour.
 *
 * `nominal` shares that tone rather than taking one of its own — a quiet drone
 * and a flying one are both healthy, and the difference between them is carried
 * by shape below and stated outright by the row's own armed glyph.
 */
export const SWARM_SEVERITY_LEVEL: Record<SwarmSeverity, StatusLevel> = {
  noBeacon: "serious",
  offline: "offline",
  error: "critical",
  warning: "warning",
  armed: "good",
  nominal: "good",
};

/**
 * Filled for anything that wants attention, hollow for the quiet majority.
 *
 * This is the "twenty healthy rows must disappear" rule made literal. A filled
 * accent dot on every nominal slot is the loudest mark in the table sitting
 * exactly where nothing is wrong, which inverts the whole board's ordering
 * argument. Shape is also the non-colour channel: a colour-blind operator still
 * reads hollow as "nothing to do here".
 */
export const SWARM_SEVERITY_SHAPE: Record<SwarmSeverity, "dot" | "ring"> = {
  noBeacon: "dot",
  offline: "dot",
  error: "dot",
  warning: "dot",
  armed: "dot",
  nominal: "ring",
};

/** Below this the track angle is velocity noise, not a heading. */
export const SWARM_HEADING_MIN_SPEED_MS = 0.5;

/** A link this weak is one fade from a dropped slot. Aggregated, never per-row. */
export const SWARM_WEAK_RSSI_DBM = -80;

export interface SwarmSlotRow {
  readonly slot: number;
  /** Null when the slot is registered but silent. */
  readonly beacon: SwarmBeaconRow | null;
  /** Null when a beacon arrives from a slot no registered node claims. */
  readonly node: FleetNodeEntry | null;
  readonly summary: CommandAgentSummary | null;
  readonly severity: SwarmSeverity;
}

/**
 * One slot's worst condition, in the store's precedence. Kept byte-for-byte
 * identical to `selectSwarmSeverityCounts` so a chip's number is exactly the
 * set of rows that chip filters to.
 */
export function swarmRowSeverity(beacon: SwarmBeaconRow | null): SwarmSeverity {
  if (!beacon) return "noBeacon";
  if (beacon.ageMs >= SWARM_BEACON_STALE_MS) return "offline";
  if (beacon.emergency) return "error";
  if (!beacon.gpsOk) return "warning";
  if (beacon.armed) return "armed";
  return "nominal";
}

/** How much a slot's last beacon is worth, in the board's shared vocabulary. */
export function swarmBeaconFreshness(
  beacon: SwarmBeaconRow | null,
): ReadingFreshness {
  if (!beacon) return "none";
  return beacon.ageMs >= SWARM_BEACON_STALE_MS ? "stale" : "fresh";
}

/**
 * The arrow angle for a slot, in compass degrees.
 *
 * The beacon carries no heading — every reference implementation derives it
 * from the velocity vector, and so does this. `atan2(vy, vx)` over NED gives
 * the track angle directly. Below the speed floor that angle is noise, so a
 * hovering drone shows the heading the agent last resolved rather than an arrow
 * that spins on the spot.
 */
export function swarmHeadingDeg(beacon: SwarmBeaconRow): number {
  const speed = Math.hypot(beacon.vxMs, beacon.vyMs);
  if (speed < SWARM_HEADING_MIN_SPEED_MS) return normalizeDeg(beacon.headingDeg);
  return normalizeDeg((Math.atan2(beacon.vyMs, beacon.vxMs) * 180) / Math.PI);
}

function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/**
 * Join the beacons to the registered slots. The row set is the UNION of both:
 * a registered slot with no beacon is an exception the operator must see, and a
 * beacon from an unregistered slot is a drone nobody provisioned — hiding
 * either would make the board lie by omission.
 */
export function buildSwarmSlotRows(
  beacons: readonly SwarmBeaconRow[],
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>,
  summariesByDeviceId: ReadonlyMap<string, CommandAgentSummary>,
): SwarmSlotRow[] {
  const beaconBySlot = new Map(beacons.map((beacon) => [beacon.slot, beacon]));
  const slots = new Set<number>(nodesBySlot.keys());
  for (const beacon of beacons) slots.add(beacon.slot);

  const rows: SwarmSlotRow[] = [];
  for (const slot of slots) {
    const beacon = beaconBySlot.get(slot) ?? null;
    const node = nodesBySlot.get(slot) ?? null;
    const deviceId = node?.deviceId ?? beacon?.deviceId ?? null;
    rows.push({
      slot,
      beacon,
      node,
      summary: deviceId ? (summariesByDeviceId.get(deviceId) ?? null) : null,
      severity: swarmRowSeverity(beacon),
    });
  }
  return rows;
}

/**
 * Exception-first order: worst severity at the top, slot number breaking ties.
 *
 * The tiebreak is the slot rather than the name or the age so the healthy tail
 * holds still. A block of rows that reshuffles under the cursor every second is
 * a block an operator stops reading, which is the failure this ordering exists
 * to prevent.
 */
export function sortSwarmRowsUnhealthyFirst(
  rows: readonly SwarmSlotRow[],
): SwarmSlotRow[] {
  return [...rows].sort((a, b) => {
    const rank =
      SWARM_SEVERITY_ORDER.indexOf(a.severity) -
      SWARM_SEVERITY_ORDER.indexOf(b.severity);
    return rank !== 0 ? rank : a.slot - b.slot;
  });
}

export type SwarmSeverityCounts = Record<SwarmSeverityId, number>;

/** One count per filter chip. `nominal` rows are counted by nobody, on purpose. */
export function swarmSeverityCounts(
  rows: readonly SwarmSlotRow[],
): SwarmSeverityCounts {
  const counts: SwarmSeverityCounts = {
    error: 0,
    noBeacon: 0,
    offline: 0,
    warning: 0,
    armed: 0,
  };
  for (const row of rows) {
    if (row.severity !== "nominal") counts[row.severity] += 1;
  }
  return counts;
}

/** `null` shows every row; a chip narrows to exactly the rows it counted. */
export function matchesSeverityFilter(
  filter: SwarmSeverityId | null,
  severity: SwarmSeverity,
): boolean {
  return filter === null || filter === severity;
}

/**
 * Cross-cutting conditions, counted across the fleet.
 *
 * These are not severities and never become rows of their own: EEMUA 191
 * budgets one alarm per operator per ten minutes, and twenty-four drones each
 * announcing their own low battery blows that inside a second. Three drones
 * under the battery threshold is ONE number.
 */
export interface SwarmConditionCounts {
  lowBattery: number;
  hardSeparation: number;
  weakLink: number;
}

export function swarmConditionCounts(
  rows: readonly SwarmSlotRow[],
  thresholds: BatteryThresholds,
): SwarmConditionCounts {
  const counts: SwarmConditionCounts = {
    lowBattery: 0,
    hardSeparation: 0,
    weakLink: 0,
  };
  for (const row of rows) {
    const band = batteryBand(
      row.summary?.telemetry.batteryRemaining ?? null,
      thresholds,
    );
    if (band === "warning" || band === "critical") counts.lowBattery += 1;
    if (row.beacon?.modePrecedence === "hard-separation") {
      counts.hardSeparation += 1;
    }
    const rssi = row.beacon?.rssiDbm;
    if (rssi != null && rssi <= SWARM_WEAK_RSSI_DBM) counts.weakLink += 1;
  }
  return counts;
}

/** The label a row answers to: its node name, else its device id, else its slot. */
export function swarmRowName(row: SwarmSlotRow, slotLabel: string): string {
  return row.node?.name ?? row.beacon?.deviceId ?? slotLabel;
}

/** The device the row's commands and its hero request address, when known. */
export function swarmRowDeviceId(row: SwarmSlotRow): string | null {
  return row.node?.deviceId ?? row.beacon?.deviceId ?? null;
}
