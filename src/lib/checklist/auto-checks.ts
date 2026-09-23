/**
 * @module checklist/auto-checks
 * @description The verdicts behind the pre-flight checklist's AUTO items.
 *
 * Every verdict reads telemetry that is still fresh at `now`. A sample
 * older than `TELEMETRY_STALE_MS`, or one that carries no usable value (a
 * battery remaining of -1, a pack voltage with no known cell count), reads as
 * `pending` and shows "—": the item waits for evidence instead of keeping the
 * last verdict it ever saw. Pending auto items can be skipped by the operator.
 *
 * Pure: the caller gathers the inputs and supplies the clock.
 *
 * @license GPL-3.0-only
 */

import type { BatteryData, EkfData, GpsData } from "@/lib/types/telemetry";
import { freshOnly, isFresh } from "@/lib/telemetry/freshness";
import { plausibleCellVoltages, resolveCellCount } from "@/lib/telemetry/battery-cells";
import { knownRemainingPct } from "@/lib/battery-bands";

/**
 * Lowest resting voltage per cell accepted before flight. It sits above the
 * in-flight warning threshold, so a pack that passes here does not raise a
 * low-voltage warning the moment it is loaded.
 */
export const PREFLIGHT_MIN_CELL_V = 3.7;
/** Battery remaining (percent) that must be exceeded before flight. */
export const PREFLIGHT_MIN_REMAINING_PCT = 20;
/** Satellites required for the GPS item. */
export const PREFLIGHT_MIN_SATELLITES = 8;
/** EKF velocity and horizontal-position variance limit. */
export const PREFLIGHT_MAX_EKF_VARIANCE = 1.0;

export const NOT_MEASURED = "—";

export type AutoCheckId =
  | "battery-level"
  | "battery-voltage"
  | "gps-fix"
  | "gps-sats"
  | "ekf-ok"
  | "sensors-healthy"
  | "prearm-pass"
  | "flight-plan"
  | "geofence-set";

export interface AutoCheckVerdict {
  status: "pending" | "pass" | "fail";
  displayValue?: string;
}

export type AutoCheckVerdicts = Record<AutoCheckId, AutoCheckVerdict>;

export interface SensorHealthSnapshot {
  /** When SYS_STATUS last updated the sensor table (ms epoch, 0 = never). */
  lastUpdate: number;
  healthyCount: number;
  presentCount: number;
  /** The FC's own pre-arm verdict bit, when the vehicle publishes it. */
  prearm: { present: boolean; healthy: boolean } | undefined;
}

export interface AutoCheckInputs {
  battery: BatteryData | undefined;
  /** Series cell count known independently of the live voltage, else null. */
  knownCellCount: number | null;
  gps: GpsData | undefined;
  ekf: EkfData | undefined;
  sensors: SensorHealthSnapshot;
  /**
   * Waypoints in the plan the selected drone acknowledged (its upload receipt
   * matches the planner's current plan), or null when the vehicle is not known
   * to hold this plan.
   */
  missionOnVehicle: number | null;
  /**
   * Enable flag of the fence the selected drone acknowledged (receipt matches
   * the current fence, whose upload writes the enable parameter), or null when
   * the vehicle is not known to hold this fence.
   */
  fenceOnVehicle: boolean | null;
  /** Localised label for a MAVLink GPS_FIX_TYPE. */
  formatGpsFix: (fixType: number) => string;
}

const UNKNOWN: AutoCheckVerdict = { status: "pending", displayValue: NOT_MEASURED };
/** A plan or fence the vehicle has not acknowledged proves nothing about it. */
const NOT_ON_VEHICLE: AutoCheckVerdict = { status: "pending", displayValue: "Not on vehicle" };

function batteryLevel(b: BatteryData | undefined): AutoCheckVerdict {
  const remaining = knownRemainingPct(b?.remaining);
  if (remaining === null) return UNKNOWN;
  return {
    status: remaining > PREFLIGHT_MIN_REMAINING_PCT ? "pass" : "fail",
    displayValue: `${Math.round(remaining)}%`,
  };
}

function batteryVoltage(
  b: BatteryData | undefined,
  knownCellCount: number | null,
): AutoCheckVerdict {
  if (!b || !Number.isFinite(b.voltage) || b.voltage <= 0) return UNKNOWN;
  // Measured cells: the weakest cell decides.
  const cells = plausibleCellVoltages(b.cellVoltages);
  if (cells) {
    const weakest = Math.min(...cells);
    return {
      status: weakest >= PREFLIGHT_MIN_CELL_V ? "pass" : "fail",
      displayValue: `${weakest.toFixed(2)}V/cell`,
    };
  }
  // Pack voltage over a cell count known independently of the voltage.
  const count = resolveCellCount(undefined, knownCellCount ?? b.cellCount);
  if (count === null) {
    // Pack voltage alone cannot say whether a pack is charged.
    return { status: "pending", displayValue: `${b.voltage.toFixed(1)}V` };
  }
  const perCell = b.voltage / count;
  return {
    status: perCell >= PREFLIGHT_MIN_CELL_V ? "pass" : "fail",
    displayValue: `${perCell.toFixed(2)}V/cell (${count}S)`,
  };
}

export function evaluateAutoChecks(inputs: AutoCheckInputs, now: number): AutoCheckVerdicts {
  const battery = freshOnly(inputs.battery, now);
  const gps = freshOnly(inputs.gps, now);
  const ekf = freshOnly(inputs.ekf, now);
  const sensorsFresh = isFresh(inputs.sensors.lastUpdate, now);

  const gpsFix: AutoCheckVerdict = gps
    ? {
        status: gps.fixType >= 3 ? "pass" : "fail",
        displayValue: inputs.formatGpsFix(gps.fixType),
      }
    : UNKNOWN;
  const gpsSats: AutoCheckVerdict = gps && gps.satellites !== undefined
    ? {
        status: gps.satellites >= PREFLIGHT_MIN_SATELLITES ? "pass" : "fail",
        displayValue: `${gps.satellites} sats`,
      }
    : UNKNOWN;
  const ekfOk: AutoCheckVerdict = ekf
    ? {
        status:
          ekf.velocityVariance < PREFLIGHT_MAX_EKF_VARIANCE &&
          ekf.posHorizVariance < PREFLIGHT_MAX_EKF_VARIANCE
            ? "pass"
            : "fail",
      }
    : UNKNOWN;

  const { healthyCount, presentCount, prearm } = inputs.sensors;
  const sensorsHealthy: AutoCheckVerdict =
    sensorsFresh && presentCount > 0
      ? {
          status: healthyCount === presentCount ? "pass" : "fail",
          displayValue: `${healthyCount}/${presentCount}`,
        }
      : UNKNOWN;
  // SYS_STATUS bit 28 (MAV_SYS_STATUS_PREARM_CHECK) is the FC's own verdict.
  // A vehicle that does not publish it leaves the item pending.
  const prearmPass: AutoCheckVerdict =
    sensorsFresh && prearm?.present
      ? prearm.healthy
        ? { status: "pass" }
        : { status: "fail", displayValue: "FC reports pre-arm failures" }
      : UNKNOWN;

  return {
    "battery-level": batteryLevel(battery),
    "battery-voltage": batteryVoltage(battery, inputs.knownCellCount),
    "gps-fix": gpsFix,
    "gps-sats": gpsSats,
    "ekf-ok": ekfOk,
    "sensors-healthy": sensorsHealthy,
    "prearm-pass": prearmPass,
    "flight-plan":
      inputs.missionOnVehicle === null
        ? NOT_ON_VEHICLE
        : inputs.missionOnVehicle > 0
          ? { status: "pass", displayValue: `${inputs.missionOnVehicle} wpts` }
          : { status: "fail", displayValue: "None" },
    "geofence-set":
      inputs.fenceOnVehicle === null
        ? NOT_ON_VEHICLE
        : inputs.fenceOnVehicle
          ? { status: "pass", displayValue: "Enabled" }
          : { status: "fail", displayValue: "Disabled" },
  };
}
