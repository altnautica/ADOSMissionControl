// The battery reading a surface trusts and its alert bands. An unknown
// battery (no engine reading, `-1`, null, or a pack voltage that says nobody is
// measuring) is null: shown as a dash, never alerting. Structural input types,
// so any surface's battery read model fits.

import layoutJson from "../cockpit-spec/layout.json";

/** The low band when the battery engine reports no reserve (spec
 *  `layout.json` `battery.low_fallback_pct`). */
export const BATTERY_LOW_PCT: number = layoutJson.battery.low_fallback_pct;
export const BATTERY_CRITICAL_PCT = 10;

/** One pack of the battery engine read model (`GET /api/v1/battery`). */
export interface BatteryPackInput {
  id: number;
  stale: boolean;
  remaining_pct?: number | null;
  prediction?: { eta_s?: number | null } | null;
  anomalies?: readonly { rule: string; severity: string; cleared_at_ms?: number | null }[];
}

/** The battery engine read model. */
export interface BatteryHealthInput {
  enabled: boolean;
  stale: boolean;
  thresholds?: { reserve_percent?: number | null } | null;
  packs: readonly BatteryPackInput[];
}

/** The flight controller's own battery block of the telemetry snapshot. */
export interface FcBatteryInput {
  battery?: { remaining?: number | null; voltage?: number | null } | null;
}

/** Whether a pack voltage is a real measurement: MAVLink reports 65535 mV with
 *  no battery monitor and 0 with nothing attached (the agent divides by 1000,
 *  so the exact sentinel is reversed; a real 65.5 V pack is 65500 mV). */
export function batteryIsMeasured(voltage: number | null | undefined): boolean {
  if (typeof voltage !== "number" || !Number.isFinite(voltage)) return false;
  const mv = Math.round(voltage * 1000);
  return mv > 0 && mv !== 65535;
}

export interface BatteryReading {
  pct: number;
  /** Seconds until the reserve threshold, from the battery engine. */
  timeToReserveS: number | null;
  source: "engine" | "fc";
}

/**
 * The battery a surface trusts: the battery engine's freshest pack when the
 * node runs one, else the flight controller's own percentage corroborated by a
 * measured pack voltage. Null means unknown, which is shown as a dash and
 * never alerts.
 */
export function batteryReading(battery: BatteryHealthInput | null, telemetry: FcBatteryInput | null): BatteryReading | null {
  if (battery && battery.enabled && !battery.stale) {
    const pack = battery.packs.find((p) => !p.stale && typeof p.remaining_pct === "number" && p.remaining_pct >= 0);
    if (pack) {
      const eta = pack.prediction?.eta_s;
      return {
        pct: pack.remaining_pct as number,
        timeToReserveS: typeof eta === "number" && Number.isFinite(eta) && eta >= 0 ? eta : null,
        source: "engine",
      };
    }
  }
  const remaining = telemetry?.battery?.remaining;
  if (typeof remaining === "number" && Number.isFinite(remaining) && remaining >= 0 && batteryIsMeasured(telemetry?.battery?.voltage)) {
    return { pct: remaining, timeToReserveS: null, source: "fc" };
  }
  return null;
}

/** The low band: the engine's reserve when it is higher than the fallback. */
export function batteryLowPct(battery: Pick<BatteryHealthInput, "thresholds"> | null): number {
  const reserve = battery?.thresholds?.reserve_percent;
  return Math.max(BATTERY_LOW_PCT, typeof reserve === "number" ? reserve : 0);
}
