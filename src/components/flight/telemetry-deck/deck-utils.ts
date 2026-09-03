import type { TelemetryDeckMetricId } from "@/stores/settings-store";
import type { DeckSeverity, DeckSeverityContext } from "./deck-types";
import { DECK_THRESHOLDS, BATTERY_CELL_WARNING_V, BATTERY_CELL_CRITICAL_V } from "./deck-constants";

/**
 * Derive cell count from pack voltage or per-cell voltages.
 * Same pattern as LiveBatteryDisplay.tsx.
 */
export function deriveCellCount(voltage: number, cellVoltages?: number[]): number {
  if (cellVoltages && cellVoltages.length > 0) return cellVoltages.length;
  if (voltage <= 0) return 0;
  return Math.round(voltage / 4.2);
}

/**
 * Evaluate severity for a metric value against its threshold config.
 * batteryVoltage uses per-cell thresholds scaled by detected cell count.
 *
 * A `rawValue` of `undefined` means the metric was never received, which is
 * not a reading to threshold. It returns "normal" rather than tripping the
 * low-value alarms: a link that has sent nothing is unknown, not at 0 dBm.
 */
export function getSeverity(
  metricId: TelemetryDeckMetricId,
  rawValue: number | undefined,
  context?: DeckSeverityContext,
): DeckSeverity {
  if (rawValue == null || Number.isNaN(rawValue)) return "normal";

  // Dynamic per-cell battery voltage thresholds
  if (metricId === "batteryVoltage") {
    const cells = context?.cellCount ?? 0;
    if (cells <= 0) return "normal";
    const warning = BATTERY_CELL_WARNING_V * cells;
    const critical = BATTERY_CELL_CRITICAL_V * cells;
    if (rawValue <= critical) return "critical";
    if (rawValue <= warning) return "warning";
    return "normal";
  }

  const cfg = DECK_THRESHOLDS[metricId];
  if (!cfg) return "normal";

  const value = cfg.mode === "absGt" ? Math.abs(rawValue) : rawValue;

  if (cfg.mode === "lt") {
    if (value <= cfg.critical) return "critical";
    if (value <= cfg.warning) return "warning";
    return "normal";
  }

  if (value >= cfg.critical) return "critical";
  if (value >= cfg.warning) return "warning";
  return "normal";
}

/**
 * Estimate remaining flight minutes from battery telemetry.
 *
 * Requires at least 5% of capacity consumed before producing an estimate,
 * otherwise the math is too unstable (dividing by near-zero consumed fraction).
 *
 * Returns `undefined` when no estimate can be made. It used to return 0, which
 * a caller cannot tell apart from a real "no endurance left" reading: a full
 * battery just after takeoff is under the 5% mark, so the sentinel reached the
 * low-endurance threshold and raised a critical alarm on a full pack.
 *
 * Future improvement: wire in BATTERY_STATUS.time_remaining from ArduPilot
 * if the MAVLink decoder is extended to parse that field.
 */
export function estimateFlightMinutes(
  remainingPct: number,
  consumedMah: number,
  currentA: number,
): number | undefined {
  if (currentA <= 0.01 || remainingPct <= 0 || consumedMah <= 0 || remainingPct >= 99.9) {
    return undefined;
  }
  const consumedFraction = 1 - remainingPct / 100;
  // Wait until at least 5% consumed for a stable estimate
  if (consumedFraction < 0.05) return undefined;
  const estimatedTotalMah = consumedMah / consumedFraction;
  const remainingMah = Math.max(estimatedTotalMah - consumedMah, 0);
  return (remainingMah / (currentA * 1000)) * 60;
}

/** The `indicators.gpsFix.*` label keys, one per MAVLink GPS_FIX_TYPE. */
export type GpsFixKey =
  | "noGps"
  | "noFix"
  | "fix2d"
  | "fix3d"
  | "dgps"
  | "rtkFloat"
  | "rtk";

/**
 * MAVLink GPS_FIX_TYPE -> its `indicators.gpsFix.*` key, resolved by the
 * calling component (this module is hook-free).
 *
 * The deck keeps the coarse three-way reading it always had: its cells sit in
 * a four-column grid that truncates, so DGPS/RTK stay under the 3D heading
 * rather than introducing longer labels. The 3D branch is `>= 3`, so the
 * STATIC (7) and PPP (8) tail reads as 3D exactly as it did before, and every
 * input resolves to a real key. Severity comes from the raw fix number, never
 * from this label.
 */
export function gpsFixKey(fixType: number): GpsFixKey {
  if (fixType >= 3) return "fix3d";
  if (fixType === 2) return "fix2d";
  return "noFix";
}

/**
 * Copy theme attributes, CSS custom properties, and class names from the
 * main window to a detached popup window so it matches the current theme.
 */
export function syncPopupTheme(targetWindow: Window): void {
  const sourceHtml = document.documentElement;
  const targetHtml = targetWindow.document.documentElement;

  targetHtml.className = sourceHtml.className;
  targetHtml.lang = sourceHtml.lang;
  targetHtml.style.cssText = sourceHtml.style.cssText;

  const sourceDataAttrs = new Set<string>();
  for (const attr of Array.from(sourceHtml.attributes)) {
    if (!attr.name.startsWith("data-")) continue;
    sourceDataAttrs.add(attr.name);
    targetHtml.setAttribute(attr.name, attr.value);
  }

  for (const attr of Array.from(targetHtml.attributes)) {
    if (!attr.name.startsWith("data-")) continue;
    if (!sourceDataAttrs.has(attr.name)) {
      targetHtml.removeAttribute(attr.name);
    }
  }

  const popupBody = targetWindow.document.body;
  popupBody.className = document.body.className;
  popupBody.style.margin = "0";
  popupBody.style.background = "var(--alt-bg-primary)";
  popupBody.style.color = "var(--alt-text-primary)";
}
