/**
 * @module LogTelemetryGraph
 * @description Collapsible telemetry graph for DroneLogsPanel.
 * Shows altitude, speed, battery, and RSSI channels from ring buffers.
 * Extracted from DroneLogsPanel.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { Activity, Gauge, Battery, Signal } from "lucide-react";

// ── Graph channel config ─────────────────────────────────────

const GRAPH_CHANNELS = [
  { key: "altitude" as const, label: "Alt", icon: Activity, color: "#3A82FF" },
  { key: "speed" as const, label: "Spd", icon: Gauge, color: "#DFF140" },
  { key: "battery" as const, label: "Bat", icon: Battery, color: "#22c55e" },
  { key: "rssi" as const, label: "RSSI", icon: Signal, color: "#f97316" },
] as const;

type ChannelKey = (typeof GRAPH_CHANNELS)[number]["key"];

export function LogTelemetryGraph() {
  const t = useTranslations("logs");

  const [activeChannels, setActiveChannels] = useState<Record<ChannelKey, boolean>>({
    altitude: true,
    speed: false,
    battery: false,
    rssi: false,
  });

  const vfrBuffer = useTelemetryStore((s) => s.vfr);
  const batteryBuffer = useTelemetryStore((s) => s.battery);
  const rcBuffer = useTelemetryStore((s) => s.rc);

  const vfrArr = vfrBuffer.toArray();
  const batteryArr = batteryBuffer.toArray();
  const rcArr = rcBuffer.toArray();

  const graphData = vfrArr.map((v, i) => ({
    time: i,
    altitude: v.alt,
    speed: v.groundspeed,
    battery: batteryArr[Math.min(i, batteryArr.length - 1)]?.voltage ?? 0,
    rssi: rcArr[Math.min(i, rcArr.length - 1)]?.rssi ?? 0,
  }));

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
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: activeChannels[key] ? color : "#333" }}
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
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#666" }} />
              <YAxis tick={{ fontSize: 10, fill: "#666" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#111116",
                  border: "1px solid #333",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#888" }}
              />
              {activeChannels.altitude && (
                <Line type="monotone" dataKey="altitude" stroke="#3A82FF" dot={false} strokeWidth={1.5} />
              )}
              {activeChannels.speed && (
                <Line type="monotone" dataKey="speed" stroke="#DFF140" dot={false} strokeWidth={1.5} />
              )}
              {activeChannels.battery && (
                <Line type="monotone" dataKey="battery" stroke="#22c55e" dot={false} strokeWidth={1.5} />
              )}
              {activeChannels.rssi && (
                <Line type="monotone" dataKey="rssi" stroke="#f97316" dot={false} strokeWidth={1.5} />
              )}
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
