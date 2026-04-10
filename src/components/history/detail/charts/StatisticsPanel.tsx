"use client";

/**
 * Statistics Panel — min/max/mean/std/p1/p50/p99 per channel.
 *
 * Phase 17b — advanced analytics.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

interface ChannelStats {
  channel: string;
  field: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  std: number;
  p1: number;
  p50: number;
  p99: number;
}

/** Extract numeric values from a channel+field across all frames. */
function extractValues(
  frames: TelemetryFrame[],
  channel: string,
  field: string,
): number[] {
  const vals: number[] = [];
  for (const f of frames) {
    if (f.channel !== channel) continue;
    const d = f.data as Record<string, unknown>;
    const raw = field.startsWith("ch") && Array.isArray(d.channels)
      ? d.channels[parseInt(field.slice(2)) - 1]
      : d[field];
    if (typeof raw === "number" && isFinite(raw)) vals.push(raw);
  }
  return vals;
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeStats(
  frames: TelemetryFrame[],
  channel: string,
  field: string,
): ChannelStats | null {
  const vals = extractValues(frames, channel, field);
  if (vals.length === 0) return null;

  const sorted = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const mean = sum / vals.length;
  const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;

  return {
    channel,
    field,
    count: vals.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    std: Math.sqrt(variance),
    p1: percentile(sorted, 1),
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
  };
}

const STAT_CHANNELS: { channel: string; label: string; fields: { key: string; label: string; unit?: string }[] }[] = [
  { channel: "position", label: "Position", fields: [
    { key: "relativeAlt", label: "Rel Alt", unit: "m" },
    { key: "groundSpeed", label: "GS", unit: "m/s" },
    { key: "climbRate", label: "Climb", unit: "m/s" },
  ]},
  { channel: "attitude", label: "Attitude", fields: [
    { key: "roll", label: "Roll", unit: "°" },
    { key: "pitch", label: "Pitch", unit: "°" },
    { key: "yaw", label: "Yaw", unit: "°" },
  ]},
  { channel: "battery", label: "Battery", fields: [
    { key: "voltage", label: "Voltage", unit: "V" },
    { key: "current", label: "Current", unit: "A" },
    { key: "remaining", label: "Remaining", unit: "%" },
  ]},
  { channel: "gps", label: "GPS", fields: [
    { key: "satellites", label: "Sats" },
    { key: "hdop", label: "HDOP" },
  ]},
  { channel: "vibration", label: "Vibration", fields: [
    { key: "vibrationX", label: "Vib X", unit: "m/s²" },
    { key: "vibrationY", label: "Vib Y", unit: "m/s²" },
    { key: "vibrationZ", label: "Vib Z", unit: "m/s²" },
  ]},
  { channel: "vfr", label: "VFR", fields: [
    { key: "throttle", label: "Throttle", unit: "%" },
  ]},
  { channel: "ekf", label: "EKF", fields: [
    { key: "velocityVariance", label: "Vel Var" },
    { key: "posHorizVariance", label: "Pos H Var" },
  ]},
];

interface StatisticsPanelProps {
  frames: TelemetryFrame[];
}

export function StatisticsPanel({ frames }: StatisticsPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const result: { group: string; stats: (ChannelStats & { label: string; unit?: string })[] }[] = [];
    for (const ch of STAT_CHANNELS) {
      const groupStats: (ChannelStats & { label: string; unit?: string })[] = [];
      for (const f of ch.fields) {
        const s = computeStats(frames, ch.channel, f.key);
        if (s) groupStats.push({ ...s, label: f.label, unit: f.unit });
      }
      if (groupStats.length > 0) result.push({ group: ch.label, stats: groupStats });
    }
    return result;
  }, [frames]);

  if (stats.length === 0) {
    return (
      <Card title="Statistics" padding={true}>
        <p className="text-[10px] text-text-tertiary">No telemetry data.</p>
      </Card>
    );
  }

  const toggle = (group: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <Card title="Statistics" padding={true}>
      <div className="flex flex-col gap-1">
        {stats.map(({ group, stats: groupStats }) => {
          const open = expanded.has(group);
          return (
            <div key={group}>
              <button
                onClick={() => toggle(group)}
                className="flex items-center gap-1 text-[10px] font-semibold text-text-secondary uppercase tracking-wider hover:text-text-primary w-full py-0.5"
              >
                {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {group}
              </button>
              {open && (
                <div className="overflow-x-auto mt-0.5">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="border-b border-border-default text-text-tertiary">
                        <th className="text-left py-0.5 px-1">Field</th>
                        <th className="text-right py-0.5 px-1">N</th>
                        <th className="text-right py-0.5 px-1">Min</th>
                        <th className="text-right py-0.5 px-1">P1</th>
                        <th className="text-right py-0.5 px-1">P50</th>
                        <th className="text-right py-0.5 px-1">Mean</th>
                        <th className="text-right py-0.5 px-1">P99</th>
                        <th className="text-right py-0.5 px-1">Max</th>
                        <th className="text-right py-0.5 px-1">Std</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupStats.map((s) => (
                        <tr key={s.field} className="border-b border-border-default last:border-0">
                          <td className="py-0.5 px-1 text-text-secondary">
                            {s.label} {s.unit && <span className="text-text-tertiary">({s.unit})</span>}
                          </td>
                          <td className="text-right py-0.5 px-1 text-text-tertiary">{s.count}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.min)}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.p1)}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.p50)}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.mean)}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.p99)}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.max)}</td>
                          <td className="text-right py-0.5 px-1 tabular-nums">{fmt(s.std)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function fmt(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
