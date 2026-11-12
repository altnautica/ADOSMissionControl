// The pre-flight checks a surface can evaluate from what the agent reports,
// and the ones the status pill lists: on the ground only, and never a check
// whose fault a base alert already reports (the pill never lists the same
// fault twice). EKF health is not on the telemetry wire, so it is not listed.

import { batteryLowPct, batteryReading, type BatteryHealthInput, type FcBatteryInput } from "./battery";
import { EKF_FLAG } from "./nav-source";

export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
}

/** The telemetry fields the home check reads: the FC's HOME_POSITION and
 *  the last EKF_STATUS_REPORT flags. */
export interface HomeTelemetry {
  home?: { lat_e7?: number | null; lon_e7?: number | null; local_ned?: unknown } | null;
  ekf?: { flags?: number | null } | null;
}

export interface PreflightInputs {
  telemetry: (FcBatteryInput & HomeTelemetry & { gps?: { fix_type?: number | null } | null }) | null;
  battery: BatteryHealthInput | null;
  /** Vehicle telemetry is live (see `vehicle-live`). */
  live: boolean;
}

/** The flight controller has a home on the ground: it reported a
 *  HOME_POSITION with a position, or its EKF has an absolute horizontal
 *  position, which needs an EKF origin (the FC sets home from it). */
export function fcHomeSet(t: HomeTelemetry | null | undefined): boolean {
  const h = t?.home;
  if (h && typeof h === "object") {
    const lat = h.lat_e7;
    const lon = h.lon_e7;
    if (typeof lat === "number" && typeof lon === "number" && (lat !== 0 || lon !== 0)) return true;
    if (Array.isArray(h.local_ned)) return true;
  }
  const flags = t?.ekf?.flags;
  return typeof flags === "number" && (flags & EKF_FLAG.POS_H_ABS) !== 0;
}

/** The checks, in checklist order. */
export function preflightChecks(i: PreflightInputs): PreflightCheck[] {
  const fix = i.telemetry?.gps?.fix_type;
  const reading = batteryReading(i.battery, i.telemetry);
  const low = batteryLowPct(i.battery);
  return [
    { id: "link", label: "Vehicle link fresh", ok: i.live },
    { id: "gps", label: "GPS fix 3D or better", ok: i.live && typeof fix === "number" && fix >= 3 },
    { id: "battery", label: "Battery above the low band", ok: reading !== null && reading.pct > low },
    { id: "home", label: "Home position set", ok: fcHomeSet(i.telemetry) },
  ];
}

/** Base alerts that already report a pre-flight check's failure. */
export const CHECK_COVERED_BY: Readonly<Record<string, readonly string[]>> = {
  link: ["link_lost", "link_stale"],
  gps: ["gps_no_3d"],
  battery: ["batt_low", "batt_crit"],
};

/** The failing checks the pill lists: none unless known to be on the ground
 *  (reported disarmed), and none a listed base alert already covers. An
 *  unknown arm state (the agent withholds `armed` while the flight
 *  controller link is down) counts as possibly airborne. */
export function preflightFailing(
  checks: readonly PreflightCheck[],
  alerts: readonly { id: string }[],
  armed: boolean | null | undefined,
): { id: string; label: string }[] {
  if (armed !== false) return [];
  const active = new Set(alerts.map((a) => a.id));
  return checks
    .filter((c) => !c.ok && !(CHECK_COVERED_BY[c.id] ?? []).some((id) => active.has(id)))
    .map((c) => ({ id: c.id, label: c.label }));
}
