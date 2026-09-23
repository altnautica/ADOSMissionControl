"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TrackingAxisResult } from "@/lib/analysis/types";

interface PidTrackingChartProps {
  data: TrackingAxisResult;
  color?: string;
}

/** Downsample data to a max number of points by taking every Nth. */
function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const result: T[] = [];
  for (let i = 0; i < arr.length; i += step) {
    result.push(arr[i]);
  }
  return result;
}

export function PidTrackingChart({ data, color = "#3A82FF" }: PidTrackingChartProps) {
  const chartData = useMemo(() => {
    const maxLen = Math.max(data.desired.length, data.actual.length);
    const points: { timeMs: number; desired: number; actual: number }[] = [];

    const startUs = data.desired[0]?.timeUs ?? data.actual[0]?.timeUs ?? 0;

    for (let i = 0; i < maxLen; i++) {
      const d = data.desired[i];
      const a = data.actual[i];
      const timeUs = d?.timeUs ?? a?.timeUs ?? startUs;
      points.push({
        timeMs: Math.round(((timeUs - startUs) / 1000) * 10) / 10,
        desired: d?.value ?? 0,
        actual: a?.value ?? 0,
      });
    }

    return downsample(points, 2000);
  }, [data]);

  const lighterColor = useMemo(() => {
    if (color.startsWith("#") && color.length === 7) {
      const r = Math.min(255, parseInt(color.slice(1, 3), 16) + 60);
      const g = Math.min(255, parseInt(color.slice(3, 5), 16) + 60);
      const b = Math.min(255, parseInt(color.slice(5, 7), 16) + 60);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    return "#9ca3af";
  }, [color]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[10px] text-text-tertiary">
        No tracking data
      </div>
    );
  }

  return (
    <div className="relative h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="timeMs"
            type="number"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            label={{ value: "ms", position: "insideBottomRight", offset: -4, fill: "#6b7280", fontSize: 10 }}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 10 }}
            label={{ value: "deg/s", angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 0,
              fontSize: 11,
            }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)} deg/s`,
              name === "desired" ? "Desired" : "Actual",
            ]}
            labelFormatter={(label: number) => `${label} ms`}
          />
          <Area
            type="monotone"
            dataKey="actual"
            stroke="none"
            fill={color}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="desired"
            stroke={lighterColor}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* RMS error badge */}
      <div className="absolute top-2 right-2 bg-bg-tertiary border border-border-default px-2 py-1">
        <span className="text-[9px] text-text-tertiary block">RMS Error</span>
        <span className="text-xs font-mono font-medium text-text-primary">
          {data.rmsError === null ? "-" : `${data.rmsError.toFixed(2)} deg/s`}
        </span>
      </div>
    </div>
  );
}
