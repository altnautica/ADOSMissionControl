"use client";

/**
 * Charts tab — multi-series telemetry charts driven by recorded frames.
 *
 * Loads frames once via {@link loadRecordingFrames}, groups by channel into
 * typed series arrays, and renders 6 stacked recharts panels sharing one
 * global time cursor (Zustand `useChartCursor`).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
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
import { loadRecordingFrames } from "@/lib/telemetry-recorder";
import { useChartCursor } from "@/stores/use-chart-cursor";
import type { FlightRecord, FlightEvent } from "@/lib/types";

interface ChartsTabProps {
  record: FlightRecord;
}

interface SeriesPoint {
  t: number; // seconds since flight start
}

interface SeriesData {
  altitude: (SeriesPoint & { alt: number })[];
  speed: (SeriesPoint & { gs?: number; as?: number })[];
  battery: (SeriesPoint & { v?: number; pct?: number })[];
  attitude: (SeriesPoint & { roll: number; pitch: number; yaw: number })[];
  gps: (SeriesPoint & { sats?: number; hdop?: number })[];
  vibration: (SeriesPoint & { vx?: number; vy?: number; vz?: number })[];
}

const EMPTY_SERIES: SeriesData = {
  altitude: [],
  speed: [],
  battery: [],
  attitude: [],
  gps: [],
  vibration: [],
};

interface PositionFrame { relativeAlt?: number; alt?: number; groundSpeed?: number }
interface VfrFrame { groundspeed?: number; airspeed?: number; alt?: number }
interface BatteryFrame { voltage?: number; remaining?: number }
interface AttitudeFrame { roll: number; pitch: number; yaw: number }
interface GpsFrame { satellites?: number; hdop?: number }
interface VibrationFrame { vibrationX?: number; vibrationY?: number; vibrationZ?: number }

function buildSeries(frames: { offsetMs: number; channel: string; data: unknown }[]): SeriesData {
  const out: SeriesData = {
    altitude: [],
    speed: [],
    battery: [],
    attitude: [],
    gps: [],
    vibration: [],
  };
  for (const f of frames) {
    const t = f.offsetMs / 1000;
    if (f.channel === "position" || f.channel === "globalPosition") {
      const d = f.data as PositionFrame;
      const alt = typeof d.relativeAlt === "number" ? d.relativeAlt : d.alt;
      if (typeof alt === "number") out.altitude.push({ t, alt });
      if (typeof d.groundSpeed === "number") out.speed.push({ t, gs: d.groundSpeed });
    } else if (f.channel === "vfr") {
      const d = f.data as VfrFrame;
      out.speed.push({ t, gs: d.groundspeed, as: d.airspeed });
      if (typeof d.alt === "number") out.altitude.push({ t, alt: d.alt });
    } else if (f.channel === "battery") {
      const d = f.data as BatteryFrame;
      out.battery.push({ t, v: d.voltage, pct: d.remaining });
    } else if (f.channel === "attitude") {
      const d = f.data as AttitudeFrame;
      const toDeg = (rad: number) => (rad * 180) / Math.PI;
      out.attitude.push({
        t,
        roll: toDeg(d.roll ?? 0),
        pitch: toDeg(d.pitch ?? 0),
        yaw: toDeg(d.yaw ?? 0),
      });
    } else if (f.channel === "gps") {
      const d = f.data as GpsFrame;
      out.gps.push({ t, sats: d.satellites, hdop: d.hdop });
    } else if (f.channel === "vibration") {
      const d = f.data as VibrationFrame;
      out.vibration.push({
        t,
        vx: d.vibrationX,
        vy: d.vibrationY,
        vz: d.vibrationZ,
      });
    }
  }
  return out;
}

export function ChartsTab({ record }: ChartsTabProps) {
  if (!record.recordingId) {
    return (
      <Card title="Charts" padding={true}>
        <p className="text-[10px] text-text-tertiary">
          No telemetry recording attached to this flight.
        </p>
      </Card>
    );
  }
  return <ChartsTabLoaded recordingId={record.recordingId} record={record} />;
}

function ChartsTabLoaded({ recordingId, record }: { recordingId: string; record: FlightRecord }) {
  const [series, setSeries] = useState<SeriesData>(EMPTY_SERIES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadRecordingFrames(recordingId).then((frames) => {
      if (cancelled) return;
      setSeries(buildSeries(frames));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  if (!loaded) {
    return (
      <Card title="Charts" padding={true}>
        <p className="text-[10px] text-text-tertiary">Loading frames…</p>
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
    </div>
  );
}

interface ChartPanelProps {
  title: string;
  data: SeriesPoint[];
  lines: { key: string; color: string; label: string }[];
  events?: FlightEvent[];
}

function ChartPanel({ title, data, lines, events }: ChartPanelProps) {
  const cursorMs = useChartCursor((s) => s.cursorMs);
  const setCursor = useChartCursor((s) => s.setCursor);

  // Hide panel if no data so we don't render an empty axis stack.
  const empty = useMemo(() => data.length === 0, [data]);
  if (empty) return null;

  const cursorSec = cursorMs !== null ? cursorMs / 1000 : null;

  return (
    <Card title={title} padding={true}>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
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
              tick={{ fill: "#6b6b7f", fontSize: 9 }}
              tickFormatter={(s) => `${Math.round(s)}s`}
            />
            <YAxis tick={{ fill: "#6b6b7f", fontSize: 9 }} width={32} />
            <Tooltip
              contentStyle={{
                background: "#0a0a0f",
                border: "1px solid #2a2a3a",
                fontSize: 10,
              }}
              labelFormatter={(s) => `t=${(s as number).toFixed(1)}s`}
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
            {cursorSec !== null && (
              <ReferenceLine x={cursorSec} stroke="#dff140" strokeDasharray="2 2" />
            )}
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
      </div>
    </Card>
  );
}
