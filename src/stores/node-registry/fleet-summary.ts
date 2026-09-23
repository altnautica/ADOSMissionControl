/**
 * @module NodeRegistry/fleet-summary
 * @description The Dashboard Overview's one fleet view model. Every card reads
 * its counts and readings from `selectFleetSummary`, so the rules for what a
 * fleet row may contribute are applied once:
 *
 *   - FC-gated fields (battery, GPS, mode, arm state) count only for a row with
 *     a live FC reading (`hasLiveFcReading`);
 *   - a battery's "not estimated" -1 is an unknown (`knownRemainingPct`), never
 *     a flat pack, so it neither drags the average down nor becomes the lowest;
 *   - an aggregate with nothing behind it is null, so a card renders "—" rather
 *     than a fabricated 0.
 *
 * Pure: identical rows and thresholds yield an identical summary.
 * @license GPL-3.0-only
 */

import type { ArmState, DroneStatus, FleetDrone } from "@/lib/types/drone";
import {
  batteryBand,
  type BatteryBand,
  type BatteryThresholds,
} from "@/lib/battery-bands";
import { knownRemainingPct } from "@/lib/battery";

/**
 * True when a fleet row's FC-gated fields (battery, GPS, mode, arm state) are a
 * current reading: a flight controller is attached, it has not gone silent, and
 * the node itself is online. Any other row's values are defaults or a frozen
 * last frame.
 */
export function hasLiveFcReading(
  drone: Pick<FleetDrone, "fcAttached" | "fcLinkLost" | "status">,
): boolean {
  return (
    drone.fcAttached === true &&
    drone.fcLinkLost !== true &&
    drone.status !== "offline"
  );
}

/** One aircraft's battery reading that counts toward the fleet aggregates. */
export interface FleetBatteryReading {
  drone: FleetDrone;
  remaining: number;
  voltage: number;
}

/** One aircraft row of the fleet telemetry readout. */
export interface FleetTelemetryRow {
  drone: FleetDrone;
  satellites: number | null;
  fixType: number | null;
  voltage: number | null;
  band: BatteryBand | undefined;
  /** False until the FC's first heartbeat: neither mode nor arm state is a
   * reading before it. */
  heard: boolean;
  armState: ArmState;
  linkLost: boolean;
}

export interface FleetSummary {
  total: number;
  statusCounts: Partial<Record<DroneStatus, number>>;
  /** Rows whose FC went silent: no arm or mission state stands behind them. */
  linkLost: FleetDrone[];
  /** Not-offline rows whose navigation reports GPS-denied. */
  gpsDeniedCount: number;
  inFlight: FleetDrone[];
  /** Drone rows with an attached FC on a node that is still connected. */
  telemetryRows: FleetTelemetryRow[];
  armedCount: number;
  gps: {
    /** Rows with a live FC reading that carry a GPS block. */
    reporting: number;
    fix3d: number;
    lowSats: number;
  };
  battery: {
    reporting: FleetBatteryReading[];
    averagePct: number | null;
    averageVoltage: number | null;
    lowest: FleetBatteryReading | null;
    /** Reporting packs in the warning or critical band. */
    lowCount: number;
  };
}

/** Satellite count below which a fix is flagged as weak. */
const LOW_SATELLITES = 6;

export function selectFleetSummary(
  drones: readonly FleetDrone[],
  thresholds: BatteryThresholds,
): FleetSummary {
  const statusCounts: Partial<Record<DroneStatus, number>> = {};
  const linkLost: FleetDrone[] = [];
  const inFlight: FleetDrone[] = [];
  const telemetryRows: FleetTelemetryRow[] = [];
  const batteries: FleetBatteryReading[] = [];
  let gpsDeniedCount = 0;
  let armedCount = 0;
  let gpsReporting = 0;
  let fix3d = 0;
  let lowSats = 0;

  for (const d of drones) {
    statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1;
    if (d.fcLinkLost === true) linkLost.push(d);
    if (d.status === "in_mission") inFlight.push(d);
    // An offline node's navigation flag is its last report, not a current fact.
    if (d.status !== "offline" && d.navigationGpsDenied === true) gpsDeniedCount++;

    const live = hasLiveFcReading(d);
    const remaining = knownRemainingPct(d.battery?.remaining);
    if (live && d.battery && remaining !== null) {
      batteries.push({ drone: d, remaining, voltage: d.battery.voltage });
    }

    if (
      d.profile !== "drone" ||
      d.fcAttached !== true ||
      d.connectionState === "disconnected"
    ) {
      continue;
    }
    if (d.armState === "armed") armedCount++;
    if (d.gps && live) {
      gpsReporting++;
      if (d.gps.fixType >= 3) fix3d++;
      if (
        d.gps.satellites !== undefined &&
        d.gps.satellites < LOW_SATELLITES &&
        d.gps.fixType > 0
      ) {
        lowSats++;
      }
    }
    telemetryRows.push({
      drone: d,
      satellites: d.gps?.satellites ?? null,
      fixType: d.gps?.fixType ?? null,
      voltage: d.battery?.voltage ?? null,
      band: batteryBand(remaining, thresholds),
      heard: d.armState !== "unknown",
      armState: d.armState,
      linkLost: d.fcLinkLost === true,
    });
  }

  const count = batteries.length;
  const lowest = batteries.reduce<FleetBatteryReading | null>(
    (min, r) => (min === null || r.remaining < min.remaining ? r : min),
    null,
  );
  const lowCount = batteries.filter((r) => {
    const band = batteryBand(r.remaining, thresholds);
    return band === "warning" || band === "critical";
  }).length;

  return {
    total: drones.length,
    statusCounts,
    linkLost,
    gpsDeniedCount,
    inFlight,
    telemetryRows,
    armedCount,
    gps: { reporting: gpsReporting, fix3d, lowSats },
    battery: {
      reporting: batteries,
      averagePct:
        count > 0 ? batteries.reduce((sum, r) => sum + r.remaining, 0) / count : null,
      averageVoltage:
        count > 0 ? batteries.reduce((sum, r) => sum + r.voltage, 0) / count : null,
      lowest,
      lowCount,
    },
  };
}
