"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { Gauge } from "lucide-react";

export function PerformancePanel() {
  const tq = useTranslations("diagnostics.performancePanel");
  const metrics = useDiagnosticsStore((s) => s.performanceMetrics);
  const updatePerf = useDiagnosticsStore((s) => s.updatePerformanceMetrics);

  // Refresh performance metrics every 1s
  useEffect(() => {
    const interval = setInterval(updatePerf, 1000);
    return () => clearInterval(interval);
  }, [updatePerf]);

  const items = [
    {
      label: "MAVLink Parse Rate",
      value: `${metrics.parseRateHz.toFixed(1)} Hz`,
      hint: "Messages decoded per second",
      color: metrics.parseRateHz > 50 ? "text-status-success" : metrics.parseRateHz > 10 ? "text-status-warning" : "text-text-secondary",
    },
    {
      label: "Avg Callback Latency",
      value: `${metrics.avgCallbackLatencyMs.toFixed(2)} ms`,
      hint: "Average time spent in message callbacks",
      color: metrics.avgCallbackLatencyMs < 1 ? "text-status-success" : metrics.avgCallbackLatencyMs < 5 ? "text-status-warning" : "text-status-error",
    },
    {
      label: "Frame Processing Time",
      value: `${metrics.frameProcessingTimeMs.toFixed(2)} ms`,
      hint: "Average time to decode + dispatch a frame",
      color: metrics.frameProcessingTimeMs < 0.5 ? "text-status-success" : metrics.frameProcessingTimeMs < 2 ? "text-status-warning" : "text-status-error",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Gauge size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">{tq("performance")}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.label}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[10px] text-text-secondary">{item.label}</span>
                <span className={`text-sm font-mono tabular-nums ${item.color}`}>{item.value}</span>
              </div>
              <span className="text-[9px] text-text-tertiary">{item.hint}</span>
            </div>
          ))}
        </div>

        {metrics.lastUpdated > 0 && (
          <div className="mt-6 text-[9px] text-text-tertiary">
            Last updated: {new Date(metrics.lastUpdated).toLocaleTimeString("en-US", { hour12: false })}
          </div>
        )}
      </div>
    </div>
  );
}
