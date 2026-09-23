import type { TelemetryDeckMetricId, TelemetryDeckPageId } from "@/stores/settings-store";

export type DeckSeverity = "normal" | "warning" | "critical";
export type DeckThresholdMode = "lt" | "gt" | "absGt";
export type DeckMetricCategory = "Flight" | "Navigation" | "Power" | "GPS" | "Link" | "Wind" | "Tuning";

export interface DeckMetricOption {
  id: TelemetryDeckMetricId;
  label: string;
  category: DeckMetricCategory;
}

export interface DeckThreshold {
  mode: DeckThresholdMode;
  warning: number;
  critical: number;
}

export interface DeckSeverityContext {
  /**
   * Series cell count for per-cell voltage thresholds, or null when neither
   * measured cells nor a known pack establish it (see `resolveCellCount`).
   */
  cellCount: number | null;
}

export type { TelemetryDeckMetricId, TelemetryDeckPageId };
