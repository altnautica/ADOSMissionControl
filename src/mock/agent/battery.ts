/**
 * @module mock/agent/battery
 * @description Demo answer for the battery-health route: two 4S packs in
 * flight, one carrying a cell-divergence warning, both with a normal
 * time-to-reserve prediction. Thresholds come from the live demo config's
 * `battery.*` block, so an edit on the Setup segment reads back on the Live
 * one, and disabling the engine there empties the pack list the same way the
 * agent does.
 * @license GPL-3.0-only
 */

import type { BatteryHealth, BatteryThresholds } from "@/lib/agent/schemas/battery";
import { getMockConfig } from "./config";
import { jitter, startTime } from "./utils";

/** When the seeded divergence first fired: shortly after the demo booted. */
const DIVERGENCE_FIRST_SEEN_MS = startTime + 5_000;

const DEFAULT_THRESHOLDS: BatteryThresholds = {
  enabled: true,
  low_cell_mv: 3500,
  critical_cell_mv: 3300,
  cell_divergence_mv: 50,
  voltage_drop_mv_per_s: 500,
  temp_spike_dc_per_s: 50,
  predictive_window_s: 30,
  reserve_percent: 25,
};

export function buildMockBatteryHealth(nowMs: number): BatteryHealth {
  const block = getMockConfig().battery;
  const thresholds: BatteryThresholds =
    block && typeof block === "object"
      ? { ...DEFAULT_THRESHOLDS, ...(block as Partial<BatteryThresholds>) }
      : DEFAULT_THRESHOLDS;
  const base = { stale: false, updated_at_ms: nowMs, thresholds };
  if (!thresholds.enabled) return { ...base, enabled: false, packs: [] };

  const primaryCells = [3.86, 3.87, 3.79, 3.86];
  const secondaryCells = [3.88, 3.89, 3.88, 3.87];
  const primaryDivergenceMv = 80;

  return {
    ...base,
    enabled: true,
    packs: [
      {
        id: 0,
        cells_plausible: true,
        cell_voltages_v: primaryCells,
        weakest_cell_index: 2,
        min_cell_v: 3.79,
        max_cell_v: 3.87,
        divergence_mv: primaryDivergenceMv,
        voltage_v: 15.38,
        current_a: Number(jitter(18.4, 0.6).toFixed(1)),
        remaining_pct: 62,
        temperature_c: 34.5,
        consumed_mah: 1840,
        consumed_wh: 28.1,
        prediction: {
          state: "normal",
          eta_s: 420,
          drop_pct_per_s: 0.088,
          mean_current_a: 18.2,
        },
        anomalies: [
          {
            rule: "cell_divergence",
            severity: "warning",
            value: primaryDivergenceMv,
            threshold: thresholds.cell_divergence_mv,
            first_seen_ms: DIVERGENCE_FIRST_SEEN_MS,
            last_seen_ms: nowMs,
            cleared_at_ms: null,
          },
        ],
        history: [
          {
            rule: "cell_divergence",
            severity: "warning",
            state: "raised",
            at_ms: DIVERGENCE_FIRST_SEEN_MS,
            value: primaryDivergenceMv,
          },
        ],
      },
      {
        id: 1,
        cells_plausible: true,
        cell_voltages_v: secondaryCells,
        weakest_cell_index: 3,
        min_cell_v: 3.87,
        max_cell_v: 3.89,
        divergence_mv: 20,
        voltage_v: 15.52,
        current_a: Number(jitter(17.9, 0.6).toFixed(1)),
        remaining_pct: 64,
        temperature_c: 33.8,
        consumed_mah: 1790,
        consumed_wh: 27.4,
        prediction: {
          state: "normal",
          eta_s: 445,
          drop_pct_per_s: 0.088,
          mean_current_a: 17.8,
        },
        anomalies: [],
        history: [],
      },
    ],
  };
}
