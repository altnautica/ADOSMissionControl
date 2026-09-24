"use client";

/**
 * @module history/detail/charts/custom-chart/UPlotChart
 * @description uPlot wrapper for the multi-trace custom chart. Owns
 * the uPlot lifecycle (mount, redraw on data change, dispose, ResizeObserver).
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { CHANNEL_REGISTRY } from "./channel-registry";
import { extractTraceData } from "./trace-data";
import type { TraceConfig } from "./types";

const CHART_HEIGHT = 220;
const FALLBACK_WIDTH = 600;

export interface UPlotChartProps {
  frames: TelemetryFrame[];
  traces: TraceConfig[];
}

export function UPlotChart({ frames, traces }: UPlotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const { times, values } = useMemo(
    () => extractTraceData(frames, traces),
    [frames, traces],
  );

  useEffect(() => {
    if (!containerRef.current || times.length === 0) return;

    const el = containerRef.current;
    const width = el.clientWidth || FALLBACK_WIDTH;

    const series: uPlot.Series[] = [
      { label: "Time (s)" },
      ...traces.map((tr) => {
        const chanDef = CHANNEL_REGISTRY.find((c) => c.channel === tr.channel);
        const fieldDef = chanDef?.fields.find((f) => f.key === tr.field);
        return {
          label: `${chanDef?.label ?? tr.channel} · ${fieldDef?.label ?? tr.field}`,
          stroke: tr.color,
          width: 1.5,
          spanGaps: true,
        } satisfies uPlot.Series;
      }),
    ];

    const opts: uPlot.Options = {
      width,
      height: CHART_HEIGHT,
      cursor: {
        drag: { x: true, y: false, setScale: true },
      },
      scales: {
        x: { time: false },
      },
      axes: [
        {
          stroke: "#6b6b7f",
          grid: { stroke: "#1f1f2e", dash: [3, 3] },
          ticks: { stroke: "#1f1f2e" },
          font: "9px JetBrains Mono, monospace",
          values: (_: uPlot, vals: number[]) => vals.map((v) => `${Math.round(v)}s`),
        },
        {
          stroke: "#6b6b7f",
          grid: { stroke: "#1f1f2e", dash: [3, 3] },
          ticks: { stroke: "#1f1f2e" },
          font: "9px JetBrains Mono, monospace",
          size: 48,
        },
      ],
      series,
    };

    const data: uPlot.AlignedData = [times, ...values];

    // Destroy previous instance
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new uPlot(opts, data, el);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [times, values, traces]);

  // Resize handling
  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: CHART_HEIGHT });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [times]); // re-attach after chart recreate

  if (times.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-[10px] text-text-tertiary">
        No data for selected traces.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}
