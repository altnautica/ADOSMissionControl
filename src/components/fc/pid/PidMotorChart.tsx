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
  ReferenceArea,
  Legend,
} from "recharts";
import type { MotorAnalysis } from "@/lib/analysis/types";
import { CHART_ERROR, CHART_GRID, CHART_TICK, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE, MOTOR_COLORS } from "../chart-theme";

interface PidMotorChartProps {
  data: MotorAnalysis;
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

export function PidMotorChart({ data }: PidMotorChartProps) {
  const chartData = useMemo(() => {
    const { motors, motorCount } = data.timeSeries;
    if (motors.length === 0 || motors[0].length === 0) return [];

    // Merge all motor time series into chart-friendly rows
    const maxLen = Math.max(...motors.slice(0, motorCount).map((m) => m.length));
    const startUs = motors[0][0]?.timeUs ?? 0;

    const points: Record<string, number>[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, number> = {
        timeMs: 0,
      };
      for (let m = 0; m < motorCount; m++) {
        const sample = motors[m]?.[i];
        if (sample) {
          row.timeMs = Math.round(((sample.timeUs - startUs) / 1000) * 10) / 10;
          row[`M${m + 1}`] = Math.round(sample.value);
        }
      }
      points.push(row);
    }

    return downsample(points, 3000);
  }, [data.timeSeries]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[10px] text-text-tertiary">
        No motor data
      </div>
    );
  }

  const motorCount = data.timeSeries.motorCount;

  return (
    <div className="h-[200px]">
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
            domain={[1000, 2000]}
            tick={{ fill: CHART_TICK, fontSize: 10 }}
            label={{ value: "PWM (us)", angle: -90, position: "insideLeft", fill: CHART_TICK, fontSize: 10 }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            labelFormatter={(label: number) => `${label} ms`}
          />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            iconType="line"
            iconSize={10}
          />
          <ReferenceArea
            y1={1900}
            y2={2000}
            fill={CHART_ERROR}
            fillOpacity={0.1}
            label={{ value: "Saturation", fill: CHART_ERROR, fontSize: 9, position: "insideTopRight" }}
          />
          {Array.from({ length: motorCount }, (_, i) => (
            <Line
              key={`M${i + 1}`}
              type="monotone"
              dataKey={`M${i + 1}`}
              stroke={MOTOR_COLORS[i % MOTOR_COLORS.length]}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
