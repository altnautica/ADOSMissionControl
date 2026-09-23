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
import { AXIS_COLORS, CHART_GRID, CHART_TICK, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE, tint } from "../chart-theme";

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

export function PidTrackingChart({ data, color = AXIS_COLORS.roll }: PidTrackingChartProps) {
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

  const lighterColor = useMemo(() => tint(color), [color]);

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
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
          <XAxis
            dataKey="timeMs"
            type="number"
            tick={{ fill: CHART_TICK, fontSize: 10 }}
            label={{ value: "ms", position: "insideBottomRight", offset: -4, fill: CHART_TICK, fontSize: 10 }}
          />
          <YAxis
            tick={{ fill: CHART_TICK, fontSize: 10 }}
            label={{ value: "deg/s", angle: -90, position: "insideLeft", fill: CHART_TICK, fontSize: 10 }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
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
