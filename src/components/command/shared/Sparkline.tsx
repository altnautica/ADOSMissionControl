"use client";

/**
 * @module Sparkline
 * @description Rolling utilisation sparkline for one agent-system history ring
 * (CPU or memory). The stroke comes from a theme token, the chart data is
 * memoised on the ring so a 1 Hz store tick that leaves the ring untouched does
 * not re-map it, and the chart dims with a "paused" overlay while the agent
 * link is stale. Renders nothing until two samples exist.
 * @license GPL-3.0-only
 */

import { useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useFreshness } from "@/lib/agent/freshness";
import { cn } from "@/lib/utils";

/** History rings on the agent-system store; each doubles as its `agent.*` label key. */
export type SparklineSeries = "cpuHistory" | "memoryHistory";

interface SparklineProps {
  series: SparklineSeries;
  /** CSS custom property for the live stroke, e.g. `--color-accent-primary`. */
  tokenColor: `--${string}`;
}

export function Sparkline({ series, tokenColor }: SparklineProps) {
  const t = useTranslations("agent");
  const history = useAgentSystemStore((s) => s[series]);
  const freshness = useFreshness();
  const gradientId = useId();
  const isStale = freshness.state !== "live" && freshness.state !== "unknown";
  const data = useMemo(() => history.map((value, i) => ({ i, value })), [history]);

  if (data.length < 2) return null;

  const strokeColor = isStale ? "var(--color-text-tertiary)" : `var(${tokenColor})`;

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-3 bg-bg-secondary transition-opacity",
        isStale && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{t(series)}</span>
        <span
          className={cn(
            "text-xs font-mono",
            isStale ? "text-text-tertiary" : "text-text-primary"
          )}
        >
          {`${data[data.length - 1].value.toFixed(1)}%`}
        </span>
      </div>
      <div className="relative" style={{ width: "100%", height: 60 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
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
