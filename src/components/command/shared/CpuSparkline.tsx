"use client";

/**
 * @module CpuSparkline
 * @description Rolling CPU usage sparkline chart using recharts.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useAgentStore } from "@/stores/agent-store";

export function CpuSparkline() {
  const t = useTranslations("agent");
  const cpuHistory = useAgentStore((s) => s.cpuHistory);
  const data = cpuHistory.map((value, i) => ({ i, value }));

  if (data.length < 2) return null;

  return (
    <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{t("cpuHistory")}</span>
        <span className="text-xs text-text-primary font-mono">
          {data.length > 0 ? `${data[data.length - 1].value.toFixed(1)}%` : "--"}
        </span>
      </div>
      <div style={{ width: "100%", height: 60 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3A82FF" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3A82FF" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke="#3A82FF"
              strokeWidth={1.5}
              fill="url(#cpuGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
