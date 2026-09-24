/**
 * @module AgentSchemas/Battery
 * @description zod schema for the agent's battery-health route
 * (`GET /api/v1/battery`): per-pack cell readings, the time-to-reserve
 * prediction, live anomalies with their hysteresis stamps, and a bounded
 * raise/clear history. The route always answers 200; a disabled engine
 * reports `enabled: false` with no packs.
 *
 * Every measurement the flight controller may not report is nullable, and the
 * per-cell aggregates are null whenever the cell array is implausible (e.g. a
 * whole-pack voltage in the first cell slot), so a surface renders "not
 * reported" instead of a fabricated reading.
 *
 * @license GPL-3.0-only
 */

import { z } from "zod";

import { NullableNumber } from "./primitives";

/** Rule ids the agent's battery engine evaluates, in evaluation order. */
export const BATTERY_RULES = [
  "cell_critical",
  "cell_low",
  "cell_divergence",
  "voltage_drop",
  "temp_spike",
  "predictive_low",
] as const;

export type BatteryRuleId = (typeof BATTERY_RULES)[number];

export const BatterySeveritySchema = z.enum(["warning", "critical"]);

export const BatteryPredictionSchema = z
  .object({
    state: z.enum(["idle", "normal", "high", "past"]),
    eta_s: NullableNumber,
    drop_pct_per_s: NullableNumber,
    mean_current_a: NullableNumber,
  })
  .passthrough();

export const BatteryAnomalySchema = z
  .object({
    // A string, not the closed rule list: a newer agent may add a rule, and
    // the page renders an unknown id raw rather than dropping the whole read.
    rule: z.string(),
    severity: BatterySeveritySchema,
    value: z.number(),
    threshold: z.number(),
    first_seen_ms: z.number(),
    last_seen_ms: z.number(),
    cleared_at_ms: NullableNumber,
  })
  .passthrough();

export const BatteryHistoryEventSchema = z
  .object({
    rule: z.string(),
    severity: BatterySeveritySchema,
    state: z.enum(["raised", "cleared"]),
    at_ms: z.number(),
    value: z.number(),
  })
  .passthrough();

export const BatteryPackSchema = z
  .object({
    id: z.number(),
    cells_plausible: z.boolean(),
    cell_voltages_v: z.array(z.number()),
    weakest_cell_index: NullableNumber,
    min_cell_v: NullableNumber,
    max_cell_v: NullableNumber,
    divergence_mv: NullableNumber,
    voltage_v: NullableNumber,
    current_a: NullableNumber,
    remaining_pct: NullableNumber,
    temperature_c: NullableNumber,
    consumed_mah: NullableNumber,
    consumed_wh: NullableNumber,
    prediction: BatteryPredictionSchema,
    anomalies: z.array(BatteryAnomalySchema),
    /** Raise/clear transitions, newest first, capped at 100. */
    history: z.array(BatteryHistoryEventSchema),
  })
  .passthrough();

/** The engine's thresholds, integer-valued so every field maps onto the
 * integer config input. Same keys as the node's `battery.*` config block. */
export const BatteryThresholdsSchema = z
  .object({
    enabled: z.boolean(),
    low_cell_mv: z.number(),
    critical_cell_mv: z.number(),
    cell_divergence_mv: z.number(),
    voltage_drop_mv_per_s: z.number(),
    temp_spike_dc_per_s: z.number(),
    predictive_window_s: z.number(),
    reserve_percent: z.number(),
  })
  .passthrough();

export const BatteryHealthSchema = z
  .object({
    enabled: z.boolean(),
    stale: z.boolean(),
    /** Epoch ms of the last ingested sample; 0 before the first one. */
    updated_at_ms: z.number(),
    thresholds: BatteryThresholdsSchema,
    packs: z.array(BatteryPackSchema),
  })
  .passthrough();

export type BatteryHealth = z.infer<typeof BatteryHealthSchema>;
export type BatteryPack = z.infer<typeof BatteryPackSchema>;
export type BatteryAnomaly = z.infer<typeof BatteryAnomalySchema>;
export type BatteryHistoryEvent = z.infer<typeof BatteryHistoryEventSchema>;
export type BatteryPrediction = z.infer<typeof BatteryPredictionSchema>;
export type BatteryThresholds = z.infer<typeof BatteryThresholdsSchema>;
