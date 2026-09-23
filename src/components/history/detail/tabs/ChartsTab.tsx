"use client";

/**
 * Charts tab — multi-series telemetry charts driven by recorded frames.
 *
 * Loads frames once via {@link loadRecordingFrames}, groups by channel into
 * typed series arrays, and renders 6 stacked recharts panels sharing one
 * global time cursor (Zustand `useChartCursor`). Each panel plots a
 * min/max-downsampled series, and the cursor is drawn by a small overlay that
 * is the only subscriber to the cursor, so moving the mouse never re-renders
 * a chart.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDecimal } from "@/lib/i18n/format";
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
import { Card } from "@/components/ui/card";
import { loadRecordingFrames, type TelemetryFrame } from "@/lib/telemetry-recorder";
import { useChartCursor } from "@/stores/use-chart-cursor";
import {
  buildSeries,
  downsampleSeries,
  EMPTY_SERIES,
  type SeriesData,
  type SeriesPoint,
} from "@/lib/flight-analysis/series-builder";
import { CustomChartBuilder } from "@/components/history/detail/charts/CustomChartBuilder";
import { StatisticsPanel } from "@/components/history/detail/charts/StatisticsPanel";
import { CorrelationPanel } from "@/components/history/detail/charts/CorrelationPanel";
import { VibrationSpectrogramPanel } from "@/components/history/detail/charts/VibrationSpectrogramPanel";
import type { FlightRecord, FlightEvent } from "@/lib/types";

interface ChartsTabProps {
  record: FlightRecord;
}

export function ChartsTab({ record }: ChartsTabProps) {
  const t = useTranslations("history");
  if (!record.recordingId) {
    return (
      <Card title="Charts" padding={true}>
        <p className="text-[10px] text-text-tertiary">
          {t("chartsNoRecording")}
        </p>
      </Card>
    );
  }
  return <ChartsTabLoaded recordingId={record.recordingId} record={record} />;
}

function ChartsTabLoaded({ recordingId, record }: { recordingId: string; record: FlightRecord }) {
  const t = useTranslations("history");
  const [series, setSeries] = useState<SeriesData>(EMPTY_SERIES);
  const [rawFrames, setRawFrames] = useState<TelemetryFrame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRecordingFrames(recordingId)
      .then((frames) => {
        if (cancelled) return;
        setSeries(buildSeries(frames));
        setRawFrames(frames);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError((err as Error).message ?? "Failed to load frames");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  if (loadError) {
    return (
      <Card title="Charts" padding={true}>
        <p className="text-[10px] text-status-error">{t("chartsLoadError")}: {loadError}</p>
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card title="Charts" padding={true}>
        <div className="flex flex-col gap-3">
          <div className="h-[140px] w-full animate-pulse rounded bg-bg-tertiary" />
          <div className="h-[140px] w-full animate-pulse rounded bg-bg-tertiary" />
          <div className="h-[140px] w-full animate-pulse rounded bg-bg-tertiary" />
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartPanel title="Altitude (m)" data={series.altitude} lines={[{ key: "alt", color: "#3a82ff", label: "Alt" }]} events={record.events} />
      <ChartPanel
        title="Speed (m/s)"
        data={series.speed}
        lines={[
          { key: "gs", color: "#22c55e", label: "Ground" },
          { key: "as", color: "#dff140", label: "Air" },
        ]}
        events={record.events}
      />
      <ChartPanel
        title="Battery"
        data={series.battery}
        lines={[
          { key: "v", color: "#dff140", label: "Voltage (V)" },
          { key: "pct", color: "#3a82ff", label: "Remaining (%)" },
        ]}
        events={record.events}
      />
      <ChartPanel
        title="Attitude (°)"
        data={series.attitude}
        lines={[
          { key: "roll", color: "#3a82ff", label: "Roll" },
          { key: "pitch", color: "#22c55e", label: "Pitch" },
          { key: "yaw", color: "#dff140", label: "Yaw" },
        ]}
        events={record.events}
      />
      <ChartPanel
        title="GPS quality"
        data={series.gps}
        lines={[
          { key: "sats", color: "#22c55e", label: "Sats" },
          { key: "hdop", color: "#ef4444", label: "HDOP" },
        ]}
        events={record.events}
      />
      <ChartPanel
        title="Vibration (m/s²)"
        data={series.vibration}
        lines={[
          { key: "vx", color: "#3a82ff", label: "X" },
          { key: "vy", color: "#22c55e", label: "Y" },
          { key: "vz", color: "#ef4444", label: "Z" },
        ]}
        events={record.events}
      />
      {/* Custom chart builder (any channel, any field, uPlot) */}
      <CustomChartBuilder frames={rawFrames} />
      {/* Statistics + correlation */}
      <StatisticsPanel frames={rawFrames} />
      <CorrelationPanel frames={rawFrames} />
      {/* Vibration spectrogram */}
      <VibrationSpectrogramPanel frames={rawFrames} />
    </div>
  );
}

interface ChartPanelProps {
  title: string;
  data: SeriesPoint[];
  lines: { key: string; color: string; label: string }[];
  events?: FlightEvent[];
}

/** Chart margins and Y-axis width; the cursor overlay maps time with the same plot box. */
const CHART_MARGIN = { top: 4, right: 4, bottom: 0, left: -20 };
const Y_AXIS_WIDTH = 32;
const X_AXIS_HEIGHT = 30;
const PLOT_LEFT_PX = CHART_MARGIN.left + Y_AXIS_WIDTH;
const PLOT_RIGHT_PX = CHART_MARGIN.right;

function ChartPanel({ title, data, lines, events }: ChartPanelProps) {
  const setCursor = useChartCursor((s) => s.setCursor);
  const locale = useLocale();

  const plotted = useMemo(() => downsampleSeries(data, lines.map((l) => l.key)), [data, lines]);
  const span = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of plotted) {
      if (p.t < min) min = p.t;
      if (p.t > max) max = p.t;
    }
    return { min, max };
  }, [plotted]);

  // Hide panel if no data so we don't render an empty axis stack.
  if (plotted.length === 0) return null;

  return (
    <Card title={title} padding={true}>
      <div className="relative h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={plotted}
            margin={CHART_MARGIN}
            onMouseMove={(state) => {
              const v = (state as { activeLabel?: number | string }).activeLabel;
              if (typeof v === "number") setCursor(v * 1000);
            }}
            onMouseLeave={() => setCursor(null)}
          >
            <CartesianGrid stroke="#1f1f2e" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              height={X_AXIS_HEIGHT}
              tick={{ fill: "#6b6b7f", fontSize: 9 }}
              tickFormatter={(s) => `${Math.round(s)}s`}
            />
            <YAxis tick={{ fill: "#6b6b7f", fontSize: 9 }} width={Y_AXIS_WIDTH} />
            <Tooltip
              contentStyle={{
                background: "#0a0a0f",
                border: "1px solid #2a2a3a",
                fontSize: 10,
              }}
              labelFormatter={(s) => `t=${formatDecimal(s as number, 1, locale)}s`}
            />
            {lines.map((l) => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                stroke={l.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name={l.label}
              />
            ))}
            {events?.map((e, i) => (
              <ReferenceLine
                key={`${e.type}-${i}`}
                x={e.t / 1000}
                stroke={
                  e.severity === "error"
                    ? "#ef4444"
                    : e.severity === "warning"
                      ? "#f59e0b"
                      : "#3a82ff"
                }
                strokeDasharray="1 3"
                strokeOpacity={0.6}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <CursorLine minSec={span.min} maxSec={span.max} />
      </div>
    </Card>
  );
}

/** The shared time cursor, positioned over the plot box without touching the chart. */
function CursorLine({ minSec, maxSec }: { minSec: number; maxSec: number }) {
  const cursorMs = useChartCursor((s) => s.cursorMs);
  if (cursorMs === null || !(maxSec > minSec)) return null;
  const frac = (cursorMs / 1000 - minSec) / (maxSec - minSec);
  if (frac < 0 || frac > 1) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute border-l border-dashed border-accent-primary"
      style={{
        top: CHART_MARGIN.top,
        bottom: X_AXIS_HEIGHT + CHART_MARGIN.bottom,
        left: `calc(${PLOT_LEFT_PX}px + (100% - ${PLOT_LEFT_PX + PLOT_RIGHT_PX}px) * ${frac})`,
      }}
    />
  );
}
