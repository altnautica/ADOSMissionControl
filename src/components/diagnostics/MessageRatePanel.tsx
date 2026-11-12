"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { Activity } from "lucide-react";

export function MessageRatePanel() {
  const tq = useTranslations("diagnostics.messageRatePanel");
  const messageRates = useDiagnosticsStore((s) => s.messageRates);
  const updateRates = useDiagnosticsStore((s) => s.updateRates);

  // Periodically refresh rates (every 1s)
  useEffect(() => {
    const interval = setInterval(updateRates, 1000);
    return () => clearInterval(interval);
  }, [updateRates]);

  const sorted = useMemo(() => {
    return Array.from(messageRates.values())
      .filter((e) => e.hz > 0)
      .sort((a, b) => b.hz - a.hz);
  }, [messageRates]);

  const totalHz = useMemo(
    () => sorted.reduce((sum, e) => sum + e.hz, 0),
    [sorted],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Activity size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">{tq("messageRates")}</span>
        <span className="text-[10px] text-text-tertiary font-mono">
          {sorted.length} type{sorted.length !== 1 ? "s" : ""}
        </span>

        <div className="flex-1" />

        <span className="text-[10px] text-text-secondary font-mono tabular-nums">
          Total: {totalHz.toFixed(1)} Hz
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
            <Activity size={24} className="text-text-tertiary" />
            <span className="text-xs text-text-tertiary">{tq("noMessageTraffic")}</span>
            <span className="text-[10px] text-text-tertiary">
              {tq("connectADroneToSee")}
            </span>
          </div>
        ) : (
          <div className="font-mono text-[10px]">
            {/* Table header */}
            <div className="flex items-center gap-0 px-4 py-1 border-b border-border-default bg-bg-tertiary text-text-tertiary sticky top-0 z-10">
              <span className="w-[200px] shrink-0">{tq("messageName")}</span>
              <span className="w-[60px] shrink-0 text-right">ID</span>
              <span className="w-[80px] shrink-0 text-right">{tq("rateHz")}</span>
              <span className="flex-1 pl-4">{tq("bar")}</span>
            </div>

            {sorted.map((entry) => {
              const maxHz = sorted[0]?.hz || 1;
              const barWidth = Math.max(1, (entry.hz / maxHz) * 100);
              return (
                <div
                  key={entry.msgId}
                  className="flex items-center gap-0 px-4 py-0.5 hover:bg-bg-tertiary/50"
                >
                  <span className="w-[200px] shrink-0 text-accent-primary truncate">
                    {entry.msgName}
                  </span>
                  <span className="w-[60px] shrink-0 text-right text-text-secondary">
                    {entry.msgId}
                  </span>
                  <span className="w-[80px] shrink-0 text-right text-text-primary tabular-nums">
                    {entry.hz.toFixed(1)}
                  </span>
                  <div className="flex-1 pl-4">
                    <div className="h-2 bg-bg-tertiary rounded overflow-hidden">
                      <div
                        className="h-full bg-accent-primary/60 rounded transition-all duration-300"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
