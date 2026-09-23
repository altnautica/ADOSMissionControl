"use client";

/**
 * @module command/blackbox/HistoryChart
 * @description A single time-aligned metric chart for the ADOS Black Box
 * review pane. Renders a durable aggregate series (from the on-device
 * store) as a filled area, X-axis bucketed by time.
 * @license GPL-3.0-only
 */

import { AreaChart, Area, ResponsiveContainer, YAxis, XAxis, Tooltip } from "recharts";
import type { AggregatePoint } from "@/lib/agent/agent-client/logging";

interface HistoryChartProps {
  title: string;
  points: AggregatePoint[];
  color: string;
  unit?: string;
  gradientId: string;
}

function fmtTime(tsUs: number): string {
  const d = new Date(tsUs / 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 5);
}

export function HistoryChart({
  title,
  points,
  color,
  unit = "%",
  gradientId,
}: HistoryChartProps) {
  // A bucket with no finite aggregate is a gap, not a zero reading.
  const data = points
    .filter((p) => Number.isFinite(p.value))
    .map((p) => ({ t: fmtTime(p.ts_us), value: p.value }));
  const latest = data.length > 0 ? data[data.length - 1].value : null;

  return (
    <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-secondary">{title}</span>
        <span className="text-xs font-mono text-text-primary">
          {latest != null ? `${latest.toFixed(1)}${unit}` : "--"}
        </span>
      </div>
      <div style={{ width: "100%", height: 120 }}>
        {data.length < 2 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-text-tertiary">
            {/* No durable series for this window. */}
            &mdash;
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tick={{ fontSize: 9, fill: "var(--alt-text-tertiary)" }}
                interval="preserveStartEnd"
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "var(--alt-text-tertiary)" }}
                width={32}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--alt-bg-secondary)",
                  border: "1px solid var(--alt-border-strong)",
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelStyle={{ color: "var(--alt-text-secondary)" }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
