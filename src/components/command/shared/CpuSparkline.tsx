"use client";

/**
 * @module CpuSparkline
 * @description Rolling CPU usage sparkline chart using recharts.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useFreshness } from "@/lib/agent/freshness";
import { cn } from "@/lib/utils";

export function CpuSparkline() {
  const t = useTranslations("agent");
  const cpuHistory = useAgentSystemStore((s) => s.cpuHistory);
  const freshness = useFreshness();
  const isStale = freshness.state !== "live" && freshness.state !== "unknown";
  const data = cpuHistory.map((value, i) => ({ i, value }));

  if (data.length < 2) return null;

  const strokeColor = isStale ? "#6B7280" : "#3A82FF";

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-3 bg-bg-secondary transition-opacity",
        isStale && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{t("cpuHistory")}</span>
        <span
          className={cn(
            "text-xs font-mono",
            isStale ? "text-text-tertiary" : "text-text-primary"
          )}
        >
          {data.length > 0 ? `${data[data.length - 1].value.toFixed(1)}%` : "--"}
        </span>
      </div>
      <div className="relative" style={{ width: "100%", height: 60 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={1.5}
              fill="url(#cpuGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        {isStale && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] uppercase tracking-widest text-text-tertiary bg-bg-primary/70 px-2 py-0.5 rounded">
              Paused
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
