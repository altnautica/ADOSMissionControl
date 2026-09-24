"use client";

/**
 * N-flight overlay modal — overlay 2–5 flight paths with color-cycling
 * polylines and a unified stats table. Extends the two-flight
 * CompareModal to N flights.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { FlightRecord } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

const OverlayMapInner = dynamic(() => import("./OverlayMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded border border-border-default text-[10px] font-mono text-text-tertiary">
      Loading map…
    </div>
  ),
});

const COLORS = [
  "#3a82ff", "#dff140", "#22c55e", "#ef4444", "#a855f7",
];

interface OverlayModalProps {
  open: boolean;
  records: FlightRecord[];
  onClose: () => void;
}

export function OverlayModal({ open, records, onClose }: OverlayModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || records.length < 2) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/70 backdrop-blur-sm">
      <div className="w-[960px] max-w-[95vw] max-h-[92vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-secondary z-10">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
              Overlay ({records.length} flights)
            </h3>
            <Legend records={records} />
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <Card title="Map" padding={true}>
            <OverlayMapInner records={records} />
          </Card>
          <OverlayStatsTable records={records} />
        </div>
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────

function Legend({ records }: { records: FlightRecord[] }) {
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap">
      {records.map((r, i) => (
        <span key={r.id} className="flex items-center gap-1">
          <span className="inline-block w-3 h-1 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
          <span className="text-text-secondary">{r.customName ?? r.droneName}</span>
        </span>
      ))}
    </div>
  );
}

// ── Stats table ──────────────────────────────────────────────

/** Shown for a value the flight did not measure. */
const NO_VALUE = "—";

function OverlayStatsTable({ records }: { records: FlightRecord[] }) {
  const metrics = useMemo(() => [
    { label: "Duration", unit: "", fmt: (r: FlightRecord) => formatDuration(Math.round(r.duration)) },
    { label: "Distance", unit: "km", fmt: (r: FlightRecord) => (r.distance !== undefined ? (r.distance / 1000).toFixed(2) : NO_VALUE) },
    { label: "Max alt", unit: "m", fmt: (r: FlightRecord) => (r.maxAlt !== undefined ? r.maxAlt.toFixed(0) : NO_VALUE) },
    { label: "Max speed", unit: "m/s", fmt: (r: FlightRecord) => (r.maxSpeed !== undefined ? r.maxSpeed.toFixed(1) : NO_VALUE) },
    { label: "Avg speed", unit: "m/s", fmt: (r: FlightRecord) => (r.avgSpeed !== undefined ? r.avgSpeed.toFixed(1) : NO_VALUE) },
    { label: "Battery", unit: "%", fmt: (r: FlightRecord) => (r.batteryUsed !== undefined ? r.batteryUsed.toFixed(0) : NO_VALUE) },
  ], []);

  return (
    <Card title="Stats" padding={true}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default">
              <th className="text-left py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Metric</th>
              {records.map((r, i) => (
                <th key={r.id} className="text-right py-1.5 px-2 text-[10px] uppercase font-semibold" style={{ color: COLORS[i % COLORS.length] }}>
                  {String.fromCharCode(65 + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.label} className="border-b border-border-default last:border-0">
                <td className="py-1.5 px-2 text-text-secondary">{m.label}</td>
                {records.map((r) => (
                  <td key={r.id} className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">
                    {m.fmt(r) === NO_VALUE ? NO_VALUE : `${m.fmt(r)} ${m.unit}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
