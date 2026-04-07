"use client";

/**
 * Compare two flights side-by-side: stats delta + map overlay + dual-trace
 * charts. Triggered from {@link HistoryBulkActions} when exactly two flights
 * are selected.
 *
 * Phase 8 — covers altitude, speed, battery, vibration. More chart panels
 * + N-flight overlay land in Phase 18.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { loadRecordingFrames } from "@/lib/telemetry-recorder";
import { buildSeries, EMPTY_SERIES, type SeriesData } from "@/lib/flight-analysis/series-builder";
import type { FlightRecord } from "@/lib/types";

const CompareMapInner = dynamic(() => import("./CompareMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center rounded border border-border-default text-[10px] font-mono text-text-tertiary">
      Loading map…
    </div>
  ),
});

const COLOR_A = "#3a82ff";
const COLOR_B = "#dff140";

interface CompareModalProps {
  open: boolean;
  recordA: FlightRecord | null;
  recordB: FlightRecord | null;
  onClose: () => void;
}

export function CompareModal({ open, recordA, recordB, onClose }: CompareModalProps) {
  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !recordA || !recordB) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[900px] max-w-[95vw] max-h-[92vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-secondary z-10">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
              Compare flights
            </h3>
            <Legend2 colorA={COLOR_A} labelA={recordA.customName ?? recordA.droneName} colorB={COLOR_B} labelB={recordB.customName ?? recordB.droneName} />
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <StatsDelta recordA={recordA} recordB={recordB} />
          <Card title="Map" padding={true}>
            <CompareMapInner recordA={recordA} recordB={recordB} />
          </Card>
          <CompareCharts recordA={recordA} recordB={recordB} />
        </div>
      </div>
    </div>
  );
}

// ── Header legend ─────────────────────────────────────────────

function Legend2({ colorA, labelA, colorB, labelB }: { colorA: string; labelA: string; colorB: string; labelB: string }) {
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono">
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-1" style={{ backgroundColor: colorA }} />
        <span className="text-text-secondary">A · {labelA}</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-3 h-1 border-t-2 border-dashed" style={{ borderColor: colorB }} />
        <span className="text-text-secondary">B · {labelB}</span>
      </span>
    </div>
  );
}

// ── Stats delta table ─────────────────────────────────────────

function StatsDelta({ recordA, recordB }: { recordA: FlightRecord; recordB: FlightRecord }) {
  const rows = [
    {
      label: "Duration",
      a: recordA.duration,
      b: recordB.duration,
      fmt: (v: number) => `${Math.floor(v / 60)}m ${(v % 60).toString().padStart(2, "0")}s`,
      unit: "",
    },
    {
      label: "Distance",
      a: recordA.distance / 1000,
      b: recordB.distance / 1000,
      fmt: (v: number) => v.toFixed(2),
      unit: "km",
    },
    { label: "Max alt", a: recordA.maxAlt, b: recordB.maxAlt, fmt: (v: number) => v.toFixed(0), unit: "m" },
    { label: "Max speed", a: recordA.maxSpeed, b: recordB.maxSpeed, fmt: (v: number) => v.toFixed(1), unit: "m/s" },
    {
      label: "Avg speed",
      a: recordA.avgSpeed ?? 0,
      b: recordB.avgSpeed ?? 0,
      fmt: (v: number) => v.toFixed(1),
      unit: "m/s",
    },
    { label: "Battery used", a: recordA.batteryUsed, b: recordB.batteryUsed, fmt: (v: number) => v.toFixed(0), unit: "%" },
    {
      label: "Waypoints",
      a: recordA.waypointCount,
      b: recordB.waypointCount,
      fmt: (v: number) => v.toString(),
      unit: "",
    },
  ];

  return (
    <Card title="Stats delta" padding={true}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-default">
            <th className="text-left py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Metric</th>
            <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">A</th>
            <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">B</th>
            <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Δ (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.b - row.a;
            const sign = delta > 0 ? "+" : delta < 0 ? "" : "";
            const colorClass =
              delta === 0
                ? "text-text-tertiary"
                : delta > 0
                  ? "text-status-success"
                  : "text-status-error";
            return (
              <tr key={row.label} className="border-b border-border-default last:border-0">
                <td className="py-1.5 px-2 text-text-secondary">{row.label}</td>
                <td className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">
                  {row.fmt(row.a)} {row.unit}
                </td>
                <td className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">
                  {row.fmt(row.b)} {row.unit}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${colorClass}`}>
                  {sign}
                  {row.fmt(delta)} {row.unit}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ── Dual-trace charts ─────────────────────────────────────────

interface DualSeriesData {
  a: SeriesData;
  b: SeriesData;
}

function CompareCharts({ recordA, recordB }: { recordA: FlightRecord; recordB: FlightRecord }) {
  const [data, setData] = useState<DualSeriesData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadOne = async (id: string | undefined): Promise<SeriesData> => {
      if (!id) return EMPTY_SERIES;
      const frames = await loadRecordingFrames(id);
      return buildSeries(frames);
    };
    void Promise.all([loadOne(recordA.recordingId), loadOne(recordB.recordingId)]).then(([a, b]) => {
      if (cancelled) return;
      setData({ a, b });
    });
    return () => {
      cancelled = true;
    };
  }, [recordA.recordingId, recordB.recordingId]);

  if (!data) {
    return (
      <Card title="Charts" padding={true}>
        <p className="text-[10px] text-text-tertiary">Loading frames…</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DualPanel
        title="Altitude (m)"
        seriesA={data.a.altitude.map((p) => ({ t: p.t, v: p.alt }))}
        seriesB={data.b.altitude.map((p) => ({ t: p.t, v: p.alt }))}
      />
      <DualPanel
        title="Ground speed (m/s)"
        seriesA={data.a.speed.map((p) => ({ t: p.t, v: p.gs ?? 0 }))}
        seriesB={data.b.speed.map((p) => ({ t: p.t, v: p.gs ?? 0 }))}
      />
      <DualPanel
        title="Battery remaining (%)"
        seriesA={data.a.battery.map((p) => ({ t: p.t, v: p.pct ?? 0 }))}
        seriesB={data.b.battery.map((p) => ({ t: p.t, v: p.pct ?? 0 }))}
      />
      <DualPanel
        title="Vibration X (m/s²)"
        seriesA={data.a.vibration.map((p) => ({ t: p.t, v: p.vx ?? 0 }))}
        seriesB={data.b.vibration.map((p) => ({ t: p.t, v: p.vx ?? 0 }))}
      />
    </div>
  );
}

interface DualPoint { t: number; v: number }

function DualPanel({
  title,
  seriesA,
  seriesB,
}: {
  title: string;
  seriesA: DualPoint[];
  seriesB: DualPoint[];
}) {
  // Merge into rows keyed on a unified t (sparse — recharts handles undefined).
  const merged = useMemo(() => {
    const map = new Map<number, { t: number; a?: number; b?: number }>();
    for (const p of seriesA) {
      map.set(p.t, { ...(map.get(p.t) ?? { t: p.t }), a: p.v });
    }
    for (const p of seriesB) {
      map.set(p.t, { ...(map.get(p.t) ?? { t: p.t }), b: p.v });
    }
    return Array.from(map.values()).sort((x, y) => x.t - y.t);
  }, [seriesA, seriesB]);

  if (seriesA.length === 0 && seriesB.length === 0) return null;

  return (
    <Card title={title} padding={true}>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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
              contentStyle={{ background: "#0a0a0f", border: "1px solid #2a2a3a", fontSize: 10 }}
              labelFormatter={(s) => `t=${(s as number).toFixed(1)}s`}
            />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Line type="monotone" dataKey="a" stroke={COLOR_A} strokeWidth={1.5} dot={false} isAnimationActive={false} name="A" />
            <Line
              type="monotone"
              dataKey="b"
              stroke={COLOR_B}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              name="B"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
