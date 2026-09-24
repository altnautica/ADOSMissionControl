/**
 * @module drone-detail/battery/battery-format
 * @description Display helpers for the Battery page: the unit each anomaly
 * rule reports its value and limit in, and the localized rule name with a raw
 * fallback for a rule a newer agent added.
 * @license GPL-3.0-only
 */

import { BATTERY_RULES } from "@/lib/agent/schemas/battery";

/** A `useTranslations("batteryHealth")` translator. */
export type BatteryTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** Glyph for a reading the node did not report. */
export const NOT_REPORTED = "—";

/**
 * Format an anomaly's value or limit in the rule's own unit: the cell rules
 * compare the weakest cell in volts, divergence is millivolts, sag and
 * temperature rise are per-second rates, and the reserve rule is seconds to
 * reserve.
 */
export function formatRuleValue(rule: string, value: number): string {
  switch (rule) {
    case "cell_critical":
    case "cell_low":
      return `${value.toFixed(2)} V`;
    case "cell_divergence":
      return `${Math.round(value)} mV`;
    case "voltage_drop":
      return `${value.toFixed(2)} V/s`;
    case "temp_spike":
      return `${value.toFixed(1)} °C/s`;
    case "predictive_low":
      return `${Math.round(value)} s`;
    default:
      return String(value);
  }
}

/** The localized rule name, or the agent's raw id for a rule this build does
 * not know. */
export function ruleLabel(t: BatteryTranslator, rule: string): string {
  return (BATTERY_RULES as readonly string[]).includes(rule)
    ? t(`rule.${rule}`)
    : rule;
}
