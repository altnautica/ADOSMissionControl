"use client";

/**
 * @module MemorySparkline
 * @description Rolling memory usage sparkline chart using recharts.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useAgentStore } from "@/stores/agent-store";

export function MemorySparkline() {
  const t = useTranslations("agent");
  const memoryHistory = useAgentStore((s) => s.memoryHistory);
  const data = memoryHistory.map((value, i) => ({ i, value }));

  if (data.length < 2) return null;

  return (
    <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{t("memoryHistory")}</span>
        <span className="text-xs text-text-primary font-mono">
          {data.length > 0 ? `${data[data.length - 1].value.toFixed(1)}%` : "--"}
        </span>
      </div>
      <div style={{ width: "100%", height: 60 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#DFF140" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#DFF140" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke="#DFF140"
              strokeWidth={1.5}
              fill="url(#memGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
