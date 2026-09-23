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
  ReferenceDot,
} from "recharts";
import type { FFTAxisResult } from "@/lib/analysis/types";
import { AXIS_COLORS, CHART_ERROR, CHART_GRID, CHART_LABEL, CHART_TICK, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE, CHART_WARNING } from "../chart-theme";

interface PidFFTChartProps {
  data: FFTAxisResult;
  color?: string;
}

export function PidFFTChart({ data, color = AXIS_COLORS.roll }: PidFFTChartProps) {
  const chartData = useMemo(
    () =>
      data.spectrum
        .filter((b) => b.frequency <= 500)
        .map((b) => ({
          frequency: Math.round(b.frequency * 10) / 10,
          magnitude: Math.round(b.magnitude * 100) / 100,
        })),
    [data.spectrum],
  );

  const peaks = useMemo(
    () =>
      data.peaks.slice(0, 5).map((p) => ({
        frequency: Math.round(p.frequency * 10) / 10,
        magnitudeDb: Math.round(p.magnitudeDb * 10) / 10,
        zone: p.zone,
      })),
    [data.peaks],
  );

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[10px] text-text-tertiary">
        No FFT data
      </div>
    );
  }

  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
          <XAxis
            dataKey="frequency"
            type="number"
            domain={[0, 500]}
            tick={{ fill: CHART_TICK, fontSize: 10 }}
            label={{ value: "Hz", position: "insideBottomRight", offset: -4, fill: CHART_TICK, fontSize: 10 }}
          />
          <YAxis
            tick={{ fill: CHART_TICK, fontSize: 10 }}
            label={{ value: "dB", angle: -90, position: "insideLeft", fill: CHART_TICK, fontSize: 10 }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            formatter={(value: number) => [`${value.toFixed(2)} dB`, "Magnitude"]}
            labelFormatter={(label: number) => `${label} Hz`}
          />
          <ReferenceArea
            x1={20}
            x2={100}
            fill={CHART_WARNING}
            fillOpacity={0.1}
            label={{ value: "Propwash", fill: CHART_WARNING, fontSize: 9, position: "insideTopLeft" }}
          />
          <ReferenceArea
            x1={200}
            x2={400}
            fill={CHART_ERROR}
            fillOpacity={0.1}
            label={{ value: "Motor Noise", fill: CHART_ERROR, fontSize: 9, position: "insideTopLeft" }}
          />
          <Line
            type="monotone"
            dataKey="magnitude"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          {peaks.map((peak, i) => (
            <ReferenceDot
              key={i}
              x={peak.frequency}
              y={peak.magnitudeDb}
              r={3}
              fill={peak.zone === "propwash" ? CHART_WARNING : peak.zone === "motor" ? CHART_ERROR : color}
              stroke="none"
              label={{
                value: `${peak.frequency}Hz`,
                position: "top",
                fill: CHART_LABEL,
                fontSize: 9,
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
