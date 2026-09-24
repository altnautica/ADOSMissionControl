/**
 * @module LogTelemetryGraph
 * @description Collapsible telemetry graph for DroneLogsPanel.
 * Shows altitude, speed, battery, and RSSI channels from ring buffers.
 * Each series is plotted at its own sample times (the streams arrive at
 * different rates), a missing reading is a gap rather than a zero, and the
 * chart follows the shared 1 Hz clock while it is open.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import type { BatteryData, RcData, VfrData } from "@/lib/types/telemetry";

// ── Graph channel config ─────────────────────────────────────

const GRAPH_CHANNELS = [
  { key: "altitude" as const, label: "Alt", color: "var(--color-accent-primary)" },
  { key: "speed" as const, label: "Spd", color: "var(--color-accent-secondary)" },
  { key: "battery" as const, label: "Bat", color: "var(--color-status-success)" },
  { key: "rssi" as const, label: "RSSI", color: "var(--color-status-warning)" },
] as const;

type ChannelKey = (typeof GRAPH_CHANNELS)[number]["key"];

/** RC_CHANNELS.rssi value that means "no RSSI reported". */
const RSSI_UNKNOWN = 255;

export interface LogGraphPoint {
  /** Seconds relative to `now` (negative = in the past). */
  t: number;
  altitude?: number;
  speed?: number;
  battery?: number;
  rssi?: number;
}

/**
 * Merge the telemetry buffers into one time-ordered point list. Every point
 * carries only the reading its own sample reported, so series recorded at
 * different rates stay aligned to their real sample times.
 */
export function buildLogGraphData(
  vfr: readonly VfrData[],
  battery: readonly BatteryData[],
  rc: readonly RcData[],
  now: number,
): LogGraphPoint[] {
  const at = (ts: number) => Math.round((ts - now) / 100) / 10;
  const points: LogGraphPoint[] = [];
  for (const v of vfr) {
    points.push({ t: at(v.timestamp), altitude: v.alt, speed: v.groundspeed });
  }
  for (const b of battery) points.push({ t: at(b.timestamp), battery: b.voltage });
  for (const r of rc) {
    if (r.rssi !== RSSI_UNKNOWN) points.push({ t: at(r.timestamp), rssi: r.rssi });
  }
  return points.sort((a, b) => a.t - b.t);
}

export function LogTelemetryGraph() {
  const [activeChannels, setActiveChannels] = useState<Record<ChannelKey, boolean>>({
    altitude: true,
    speed: false,
    battery: false,
    rssi: false,
  });

  // The buffers are mutated in place; the shared 1 Hz clock re-reads them.
  useClockTick();
  const now = useClockStore((s) => s.now);
  const graphData = useMemo(() => {
    const tel = useTelemetryStore.getState();
    return buildLogGraphData(tel.vfr.toArray(), tel.battery.toArray(), tel.rc.toArray(), now);
  }, [now]);

  const toggleChannel = (key: ChannelKey) => {
    setActiveChannels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="border-t border-border-default">
      {/* Channel toggles */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-default">
        {GRAPH_CHANNELS.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => toggleChannel(key)}
            className={`flex items-center gap-1 text-[10px] transition-colors cursor-pointer ${
              activeChannels[key] ? "text-text-primary" : "text-text-tertiary"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-bg-tertiary"
              style={activeChannels[key] ? { backgroundColor: color } : undefined}
            />
            {label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-[150px] bg-bg-secondary p-2">
        {graphData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={graphData}>
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", 0]}
                unit="s"
                tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
              />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-default)",
                  fontSize: 11,
                }}
                labelStyle={{ color: "var(--color-text-tertiary)" }}
              />
              {GRAPH_CHANNELS.filter(({ key }) => activeChannels[key]).map(({ key, color }) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
            Telemetry data will appear here when connected
          </div>
        )}
      </div>
    </div>
  );
}
