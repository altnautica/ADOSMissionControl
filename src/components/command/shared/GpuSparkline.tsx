"use client";

/**
 * @module GpuSparkline
 * @description Rolling GPU-utilisation sparkline. Mirrors {@link CpuSparkline}:
 * reads the `gpuHistory` ring off the agent-system store and the same freshness
 * model, so the workstation GPU/Compute column reads consistently with the
 * CPU/memory sparklines. Renders nothing until two samples exist.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useFreshness } from "@/lib/agent/freshness";
import { cn } from "@/lib/utils";

export function GpuSparkline() {
  const t = useTranslations("agent");
  const gpuHistory = useAgentSystemStore((s) => s.gpuHistory);
  const freshness = useFreshness();
  const isStale = freshness.state !== "live" && freshness.state !== "unknown";
  const data = gpuHistory.map((value, i) => ({ i, value }));

  if (data.length < 2) return null;

  const strokeColor = isStale ? "var(--color-text-tertiary)" : "var(--node-swatch-cyan)";

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-3 bg-bg-secondary transition-opacity",
        isStale && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{t("gpuHistory")}</span>
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
              <linearGradient id="gpuGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={1.5}
              fill="url(#gpuGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        {isStale && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] uppercase tracking-widest text-text-tertiary bg-bg-primary/70 px-2 py-0.5 rounded">
              {t("sparklinePaused")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
