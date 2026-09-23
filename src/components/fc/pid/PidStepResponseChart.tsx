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

interface PidStepResponseChartProps {
  event: StepResponseEvent;
  color?: string;
}

export function PidStepResponseChart({ event, color = "#3A82FF" }: PidStepResponseChartProps) {
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

  const lighterColor = useMemo(() => {
    // Make color lighter for desired line
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
      <div className="flex items-center justify-center h-[180px] text-[10px] text-text-tertiary">
        No step response data
      </div>
    );
  }

  return (
    <div className="relative h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
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
          {targetValue > 0 && (
            <ReferenceLine
              y={targetValue}
              stroke="#6b7280"
              strokeDasharray="4 4"
              label={{ value: `Target: ${targetValue.toFixed(0)}`, fill: "#6b7280", fontSize: 9, position: "right" }}
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
