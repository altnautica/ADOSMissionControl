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
 */
export function getSeverity(
  metricId: TelemetryDeckMetricId,
  rawValue: number,
  context?: DeckSeverityContext,
): DeckSeverity {
  if (Number.isNaN(rawValue)) return "normal";

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
 * Future improvement: wire in BATTERY_STATUS.time_remaining from ArduPilot
 * if the MAVLink decoder is extended to parse that field.
 */
export function estimateFlightMinutes(
  remainingPct: number,
  consumedMah: number,
  currentA: number,
): number {
  if (currentA <= 0.01 || remainingPct <= 0 || consumedMah <= 0 || remainingPct >= 99.9) return 0;
  const consumedFraction = 1 - remainingPct / 100;
  // Wait until at least 5% consumed for a stable estimate
  if (consumedFraction < 0.05) return 0;
  const estimatedTotalMah = consumedMah / consumedFraction;
  const remainingMah = Math.max(estimatedTotalMah - consumedMah, 0);
  return (remainingMah / (currentA * 1000)) * 60;
}

export function gpsFixLabel(fixType: number): string {
  if (fixType >= 3) return "3D";
  if (fixType === 2) return "2D";
  return "No Fix";
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
