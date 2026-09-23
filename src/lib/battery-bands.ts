"use client";

/**
 * @module lib/battery-bands
 * @description The ONE battery severity resolver for fleet surfaces.
 *
 * Severity comes from the operator's configured thresholds (Settings →
 * Notifications: `batteryWarningPct` / `batteryCriticalPct`), the same pair
 * the alert pipeline fires on — so the colour a tile turns and the alert the
 * operator hears agree, and every surface that flips between the grid and the
 * board reads the same node at the same severity. Comparison is strict
 * (`remaining < threshold`), matching the alert producer's semantics.
 *
 * Do not re-declare threshold constants at a call site: two surfaces with
 * their own numbers disagreed with each other AND with the configured alerts,
 * which is how this module came to exist.
 *
 * @license GPL-3.0-only
 */

import { useSettingsStore } from "@/stores/settings-store";
import type { StatusLevel } from "@/components/ui/status-dot";

/** The severities a battery reading can carry, as shared status levels. */
export type BatteryBand = Extract<StatusLevel, "critical" | "warning" | "good">;

export interface BatteryThresholds {
  warningPct: number;
  criticalPct: number;
}

/** Pure band resolver; `null` (no reading) stays `undefined`, never a band. */
export function batteryBand(
  remaining: number | null,
  thresholds: BatteryThresholds,
): BatteryBand | undefined {
  if (remaining == null) return undefined;
  if (remaining < thresholds.criticalPct) return "critical";
  if (remaining < thresholds.warningPct) return "warning";
  return "good";
}

/** The operator's configured thresholds, live from the settings store. */
export function useBatteryThresholds(): BatteryThresholds {
  const warningPct = useSettingsStore((s) => s.batteryWarningPct);
  const criticalPct = useSettingsStore((s) => s.batteryCriticalPct);
  return { warningPct, criticalPct };
}

/** Convenience hook: the band for a reading under the configured thresholds. */
export function useBatteryBand(remaining: number | null): BatteryBand | undefined {
  return batteryBand(remaining, useBatteryThresholds());
}
