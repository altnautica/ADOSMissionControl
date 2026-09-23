"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { StepResponseEvent } from "@/lib/analysis/types";
import { AXIS_COLORS, CHART_GRID, CHART_TICK, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE, tint } from "../chart-theme";

interface PidStepResponseChartProps {
  event: StepResponseEvent;
  color?: string;
}

export function PidStepResponseChart({ event, color = AXIS_COLORS.roll }: PidStepResponseChartProps) {
  const chartData = useMemo(() => {
    const startUs = event.startTimeUs;
    const maxLen = Math.max(event.desired.length, event.actual.length);
    const points: { timeMs: number; desired: number; actual: number }[] = [];

    for (let i = 0; i < maxLen; i++) {
      const d = event.desired[i];
      const a = event.actual[i];
      const timeUs = d?.timeUs ?? a?.timeUs ?? startUs;
      points.push({
        timeMs: Math.round(((timeUs - startUs) / 1000) * 10) / 10,
        desired: d?.value ?? 0,
        actual: a?.value ?? 0,
      });
    }
    return points;
  }, [event]);

  // Compute target value (peak of desired)
  const targetValue = useMemo(() => {
    if (event.desired.length === 0) return 0;
    return Math.max(...event.desired.map((s) => Math.abs(s.value)));
  }, [event.desired]);

  const lighterColor = useMemo(() => tint(color), [color]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[180px] text-[10px] text-text-tertiary">
        No step response data
      </div>
    );
  }

  return (
    <div className="relative h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
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
          {targetValue > 0 && (
            <ReferenceLine
              y={targetValue}
              stroke={CHART_TICK}
              strokeDasharray="4 4"
              label={{ value: `Target: ${targetValue.toFixed(0)}`, fill: CHART_TICK, fontSize: 9, position: "right" }}
            />
          )}
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
        </LineChart>
      </ResponsiveContainer>
      {/* Metric annotations */}
      <div className="absolute top-2 right-2 flex flex-col gap-0.5">
        <span className="text-[9px] font-mono text-text-tertiary bg-bg-secondary/80 px-1.5 py-0.5">
          Rise: {event.riseTimeMs.toFixed(1)}ms
        </span>
        <span className="text-[9px] font-mono text-text-tertiary bg-bg-secondary/80 px-1.5 py-0.5">
          Overshoot: {event.overshootPercent.toFixed(1)}%
        </span>
        {event.undershootPercent > 0 && (
          <span className="text-[9px] font-mono text-text-tertiary bg-bg-secondary/80 px-1.5 py-0.5">
            Undershoot: {event.undershootPercent.toFixed(1)}%
          </span>
        )}
        <span className="text-[9px] font-mono text-text-tertiary bg-bg-secondary/80 px-1.5 py-0.5">
          Settling: {event.settlingTimeMs.toFixed(1)}ms
        </span>
      </div>
    </div>
  );
}
