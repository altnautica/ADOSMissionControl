"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { TelemetryDeckMetricId, DeckMetricCategory } from "./deck-types";
import { DECK_METRIC_OPTIONS, CATEGORY_ORDER } from "./deck-constants";

interface DeckCustomizerProps {
  activeDeckMetricIds: TelemetryDeckMetricId[];
  onToggleMetric: (metric: TelemetryDeckMetricId) => void;
  onSetMetrics: (metrics: TelemetryDeckMetricId[]) => void;
  defaultFallbackMetric: TelemetryDeckMetricId;
}

export function DeckCustomizer({
  activeDeckMetricIds,
  onToggleMetric,
  onSetMetrics,
  defaultFallbackMetric,
}: DeckCustomizerProps) {
  const [pickerQuery, setPickerQuery] = useState("");

  const filteredMetricOptions = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    if (!query) return DECK_METRIC_OPTIONS;
    return DECK_METRIC_OPTIONS.filter(
      (metric) =>
        metric.label.toLowerCase().includes(query) ||
        metric.id.toLowerCase().includes(query) ||
        metric.category.toLowerCase().includes(query),
    );
  }, [pickerQuery]);

  const metricsByCategory = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        metrics: filteredMetricOptions.filter((m) => m.category === category),
      })).filter((g) => g.metrics.length > 0),
    [filteredMetricOptions],
  );

  const handleCategorySelection = (category: DeckMetricCategory, mode: "all" | "none") => {
    const categoryIds = DECK_METRIC_OPTIONS.filter((m) => m.category === category).map((m) => m.id);
    if (mode === "all") {
      const next = [...activeDeckMetricIds, ...categoryIds.filter((id) => !activeDeckMetricIds.includes(id))];
      onSetMetrics(next);
      return;
    }
    const next = activeDeckMetricIds.filter((id) => !categoryIds.includes(id));
    onSetMetrics(next.length === 0 ? [defaultFallbackMetric] : next);
  };

  return (
    <div className="border border-border-default bg-bg-secondary px-2 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Search metrics..."
          className="flex-1 h-7 px-2 text-[10px] font-mono bg-bg-tertiary border border-border-default"
        />
      </div>

      <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
        {metricsByCategory.map(({ category, metrics }) => (
          <div key={category} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-tertiary uppercase tracking-wide">{category}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleCategorySelection(category, "all")}
                  className="px-1.5 py-0.5 text-[9px] rounded border border-border-default text-text-tertiary hover:text-text-secondary"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => handleCategorySelection(category, "none")}
                  className="px-1.5 py-0.5 text-[9px] rounded border border-border-default text-text-tertiary hover:text-text-secondary"
                >
                  None
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {metrics.map((metric) => {
                const selected = activeDeckMetricIds.includes(metric.id);
                return (
                  <button
                    key={metric.id}
                    type="button"
                    onClick={() => onToggleMetric(metric.id)}
                    className={cn(
                      "px-2 py-1 text-[10px] rounded border font-mono transition-colors",
                      selected
                        ? "border-accent-primary/60 bg-accent-primary/15 text-text-primary"
                        : "border-border-default bg-bg-tertiary text-text-tertiary hover:text-text-secondary",
                    )}
                  >
                    {selected ? "✓ " : ""}
                    {metric.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-text-tertiary">Drag tiles in the deck to reorder. At least one metric stays enabled.</p>
    </div>
  );
}
