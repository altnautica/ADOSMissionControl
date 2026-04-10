"use client";

/**
 * Custom Chart Builder — pick any channel + field from a recorded flight,
 * render via uPlot for 1M+ point capability with zoom/pan.
 *
 * Phase 17a — advanced charts.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, X, RotateCcw } from "lucide-react";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

// ── Channel & field registry ─────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  unit?: string;
  extract: (data: Record<string, unknown>) => number | undefined;
}

interface ChannelDef {
  channel: string;
  label: string;
  fields: FieldDef[];
}

const RAD_TO_DEG = 180 / Math.PI;

const CHANNEL_REGISTRY: ChannelDef[] = [
  {
    channel: "position",
    label: "Position",
    fields: [
      { key: "relativeAlt", label: "Rel Alt", unit: "m", extract: (d) => num(d.relativeAlt) },
      { key: "alt", label: "Altitude MSL", unit: "m", extract: (d) => num(d.alt) },
      { key: "groundSpeed", label: "Ground Speed", unit: "m/s", extract: (d) => num(d.groundSpeed) },
      { key: "airSpeed", label: "Air Speed", unit: "m/s", extract: (d) => num(d.airSpeed) },
      { key: "climbRate", label: "Climb Rate", unit: "m/s", extract: (d) => num(d.climbRate) },
      { key: "heading", label: "Heading", unit: "°", extract: (d) => num(d.heading) },
    ],
  },
  {
    channel: "globalPosition",
    label: "Global Position",
    fields: [
      { key: "relativeAlt", label: "Rel Alt", unit: "m", extract: (d) => num(d.relativeAlt) },
      { key: "alt", label: "Altitude MSL", unit: "m", extract: (d) => num(d.alt) },
      { key: "groundSpeed", label: "Ground Speed", unit: "m/s", extract: (d) => num(d.groundSpeed) },
      { key: "heading", label: "Heading", unit: "°", extract: (d) => num(d.heading) },
    ],
  },
  {
    channel: "attitude",
    label: "Attitude",
    fields: [
      { key: "roll", label: "Roll", unit: "°", extract: (d) => maybeDeg(d.roll) },
      { key: "pitch", label: "Pitch", unit: "°", extract: (d) => maybeDeg(d.pitch) },
      { key: "yaw", label: "Yaw", unit: "°", extract: (d) => maybeDeg(d.yaw) },
      { key: "rollSpeed", label: "Roll Rate", unit: "°/s", extract: (d) => maybeDeg(d.rollSpeed) },
      { key: "pitchSpeed", label: "Pitch Rate", unit: "°/s", extract: (d) => maybeDeg(d.pitchSpeed) },
      { key: "yawSpeed", label: "Yaw Rate", unit: "°/s", extract: (d) => maybeDeg(d.yawSpeed) },
    ],
  },
  {
    channel: "battery",
    label: "Battery",
    fields: [
      { key: "voltage", label: "Voltage", unit: "V", extract: (d) => num(d.voltage) },
      { key: "current", label: "Current", unit: "A", extract: (d) => num(d.current) },
      { key: "remaining", label: "Remaining", unit: "%", extract: (d) => num(d.remaining) },
      { key: "consumed", label: "Consumed", unit: "mAh", extract: (d) => num(d.consumed) },
      { key: "temperature", label: "Temperature", unit: "°C", extract: (d) => num(d.temperature) },
    ],
  },
  {
    channel: "vfr",
    label: "VFR HUD",
    fields: [
      { key: "airspeed", label: "Airspeed", unit: "m/s", extract: (d) => num(d.airspeed) },
      { key: "groundspeed", label: "Ground Speed", unit: "m/s", extract: (d) => num(d.groundspeed) },
      { key: "throttle", label: "Throttle", unit: "%", extract: (d) => num(d.throttle) },
      { key: "alt", label: "Altitude", unit: "m", extract: (d) => num(d.alt) },
      { key: "climb", label: "Climb", unit: "m/s", extract: (d) => num(d.climb) },
    ],
  },
  {
    channel: "gps",
    label: "GPS",
    fields: [
      { key: "satellites", label: "Satellites", unit: "", extract: (d) => num(d.satellites) },
      { key: "hdop", label: "HDOP", unit: "", extract: (d) => num(d.hdop) },
      { key: "fixType", label: "Fix Type", unit: "", extract: (d) => num(d.fixType) },
    ],
  },
  {
    channel: "vibration",
    label: "Vibration",
    fields: [
      { key: "vibrationX", label: "Vib X", unit: "m/s²", extract: (d) => num(d.vibrationX) },
      { key: "vibrationY", label: "Vib Y", unit: "m/s²", extract: (d) => num(d.vibrationY) },
      { key: "vibrationZ", label: "Vib Z", unit: "m/s²", extract: (d) => num(d.vibrationZ) },
    ],
  },
  {
    channel: "rc",
    label: "RC Input",
    fields: [
      { key: "ch1", label: "CH1 (Roll)", unit: "µs", extract: (d) => chanAt(d.channels, 0) },
      { key: "ch2", label: "CH2 (Pitch)", unit: "µs", extract: (d) => chanAt(d.channels, 1) },
      { key: "ch3", label: "CH3 (Throttle)", unit: "µs", extract: (d) => chanAt(d.channels, 2) },
      { key: "ch4", label: "CH4 (Yaw)", unit: "µs", extract: (d) => chanAt(d.channels, 3) },
      { key: "ch5", label: "CH5", unit: "µs", extract: (d) => chanAt(d.channels, 4) },
      { key: "ch6", label: "CH6", unit: "µs", extract: (d) => chanAt(d.channels, 5) },
      { key: "ch7", label: "CH7", unit: "µs", extract: (d) => chanAt(d.channels, 6) },
      { key: "ch8", label: "CH8", unit: "µs", extract: (d) => chanAt(d.channels, 7) },
    ],
  },
  {
    channel: "servoOutput",
    label: "Servo Output",
    fields: [
      { key: "ch1", label: "Out 1", unit: "µs", extract: (d) => chanAt(d.channels, 0) },
      { key: "ch2", label: "Out 2", unit: "µs", extract: (d) => chanAt(d.channels, 1) },
      { key: "ch3", label: "Out 3", unit: "µs", extract: (d) => chanAt(d.channels, 2) },
      { key: "ch4", label: "Out 4", unit: "µs", extract: (d) => chanAt(d.channels, 3) },
      { key: "ch5", label: "Out 5", unit: "µs", extract: (d) => chanAt(d.channels, 4) },
      { key: "ch6", label: "Out 6", unit: "µs", extract: (d) => chanAt(d.channels, 5) },
      { key: "ch7", label: "Out 7", unit: "µs", extract: (d) => chanAt(d.channels, 6) },
      { key: "ch8", label: "Out 8", unit: "µs", extract: (d) => chanAt(d.channels, 7) },
    ],
  },
  {
    channel: "ekf",
    label: "EKF Status",
    fields: [
      { key: "velocityVariance", label: "Velocity Var", unit: "", extract: (d) => num(d.velocityVariance) },
      { key: "posHorizVariance", label: "Pos Horiz Var", unit: "", extract: (d) => num(d.posHorizVariance) },
      { key: "posVertVariance", label: "Pos Vert Var", unit: "", extract: (d) => num(d.posVertVariance) },
      { key: "compassVariance", label: "Compass Var", unit: "", extract: (d) => num(d.compassVariance) },
      { key: "terrainAltVariance", label: "Terrain Alt Var", unit: "", extract: (d) => num(d.terrainAltVariance) },
    ],
  },
  {
    channel: "wind",
    label: "Wind",
    fields: [
      { key: "direction", label: "Direction", unit: "°", extract: (d) => num(d.direction) },
      { key: "speed", label: "Speed", unit: "m/s", extract: (d) => num(d.speed) },
      { key: "speedZ", label: "Vertical Speed", unit: "m/s", extract: (d) => num(d.speedZ) },
    ],
  },
  {
    channel: "scaledImu",
    label: "Scaled IMU",
    fields: [
      { key: "xacc", label: "Accel X", unit: "mg", extract: (d) => num(d.xacc) },
      { key: "yacc", label: "Accel Y", unit: "mg", extract: (d) => num(d.yacc) },
      { key: "zacc", label: "Accel Z", unit: "mg", extract: (d) => num(d.zacc) },
      { key: "xgyro", label: "Gyro X", unit: "mrad/s", extract: (d) => num(d.xgyro) },
      { key: "ygyro", label: "Gyro Y", unit: "mrad/s", extract: (d) => num(d.ygyro) },
      { key: "zgyro", label: "Gyro Z", unit: "mrad/s", extract: (d) => num(d.zgyro) },
      { key: "xmag", label: "Mag X", unit: "mgauss", extract: (d) => num(d.xmag) },
      { key: "ymag", label: "Mag Y", unit: "mgauss", extract: (d) => num(d.ymag) },
      { key: "zmag", label: "Mag Z", unit: "mgauss", extract: (d) => num(d.zmag) },
    ],
  },
  {
    channel: "radio",
    label: "Radio Link",
    fields: [
      { key: "rssi", label: "RSSI", unit: "", extract: (d) => num(d.rssi) },
      { key: "remrssi", label: "Remote RSSI", unit: "", extract: (d) => num(d.remrssi) },
      { key: "noise", label: "Noise", unit: "", extract: (d) => num(d.noise) },
      { key: "remnoise", label: "Remote Noise", unit: "", extract: (d) => num(d.remnoise) },
    ],
  },
  {
    channel: "terrain",
    label: "Terrain",
    fields: [
      { key: "terrainHeight", label: "Terrain Height", unit: "m", extract: (d) => num(d.terrainHeight) },
      { key: "currentHeight", label: "Current AGL", unit: "m", extract: (d) => num(d.currentHeight) },
    ],
  },
];

function num(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

function maybeDeg(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  // Attitude values > 2π are likely already degrees (dataflash import).
  return Math.abs(n) > 6.3 ? n : n * RAD_TO_DEG;
}

function chanAt(v: unknown, idx: number): number | undefined {
  if (!Array.isArray(v)) return undefined;
  return num(v[idx]);
}

// ── Trace definition ─────────────────────────────────────────

interface TraceConfig {
  id: string;
  channel: string;
  field: string;
  color: string;
}

const PALETTE = [
  "#3a82ff", "#dff140", "#22c55e", "#ef4444", "#a855f7",
  "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

// ── Extract aligned data for uPlot ───────────────────────────

function extractTraceData(
  frames: TelemetryFrame[],
  traces: TraceConfig[],
): { times: number[]; values: (number | null)[][] } {
  // Group frames per trace; each trace gets its own sparse time→value map.
  const traceMaps: Map<number, number | null>[] = traces.map(() => new Map());

  for (const f of frames) {
    for (let i = 0; i < traces.length; i++) {
      const tr = traces[i];
      if (f.channel !== tr.channel) continue;
      const chanDef = CHANNEL_REGISTRY.find((c) => c.channel === tr.channel);
      const fieldDef = chanDef?.fields.find((fd) => fd.key === tr.field);
      if (!fieldDef) continue;
      const val = fieldDef.extract(f.data as Record<string, unknown>);
      const tSec = f.offsetMs / 1000;
      traceMaps[i].set(tSec, val ?? null);
    }
  }

  // Build a unified sorted time axis.
  const timeSet = new Set<number>();
  for (const m of traceMaps) {
    for (const t of m.keys()) timeSet.add(t);
  }
  const times = Array.from(timeSet).sort((a, b) => a - b);

  // Downsample when over 50k points to keep uPlot snappy.
  const MAX_PTS = 50_000;
  let sampledTimes = times;
  if (times.length > MAX_PTS) {
    const step = Math.ceil(times.length / MAX_PTS);
    sampledTimes = times.filter((_, i) => i % step === 0);
  }

  const values: (number | null)[][] = traces.map((_, i) =>
    sampledTimes.map((t) => traceMaps[i].get(t) ?? null),
  );

  return { times: sampledTimes, values };
}

// ── Component ────────────────────────────────────────────────

interface CustomChartBuilderProps {
  frames: TelemetryFrame[];
}

export function CustomChartBuilder({ frames }: CustomChartBuilderProps) {
  const [traces, setTraces] = useState<TraceConfig[]>([]);
  const [adding, setAdding] = useState(false);

  // Available channels — only channels present in the actual frames.
  const availableChannels = useMemo(() => {
    const channelsInFrames = new Set(frames.map((f) => f.channel));
    return CHANNEL_REGISTRY.filter((c) => channelsInFrames.has(c.channel));
  }, [frames]);

  const addTrace = useCallback(
    (channel: string, field: string) => {
      const color = PALETTE[traces.length % PALETTE.length];
      setTraces((prev) => [
        ...prev,
        { id: `${channel}.${field}.${Date.now()}`, channel, field, color },
      ]);
      setAdding(false);
    },
    [traces.length],
  );

  const removeTrace = useCallback((id: string) => {
    setTraces((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setTraces([]);
  }, []);

  if (traces.length === 0 && !adding) {
    return (
      <Card title="Custom Chart" padding={true}>
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-[10px] text-text-tertiary">
            Build a custom chart from any telemetry channel and field.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} icon={<Plus size={12} />}>
            Add trace
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Custom Chart" padding={true}>
      {/* Trace legend + controls */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {traces.map((tr) => {
          const chanDef = CHANNEL_REGISTRY.find((c) => c.channel === tr.channel);
          const fieldDef = chanDef?.fields.find((f) => f.key === tr.field);
          return (
            <span
              key={tr.id}
              className="inline-flex items-center gap-1 text-[10px] font-mono bg-bg-tertiary rounded px-1.5 py-0.5"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tr.color }} />
              {chanDef?.label ?? tr.channel} · {fieldDef?.label ?? tr.field}
              {fieldDef?.unit && <span className="text-text-tertiary">({fieldDef.unit})</span>}
              <button onClick={() => removeTrace(tr.id)} className="ml-0.5 text-text-tertiary hover:text-text-primary">
                <X size={10} />
              </button>
            </span>
          );
        })}
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)} icon={<Plus size={12} />}>
          Add
        </Button>
        {traces.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} icon={<RotateCcw size={12} />}>
            Clear
          </Button>
        )}
      </div>

      {/* Add trace picker */}
      {adding && (
        <TracePicker
          channels={availableChannels}
          onPick={addTrace}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* uPlot chart */}
      {traces.length > 0 && <UPlotChart frames={frames} traces={traces} />}
    </Card>
  );
}

// ── Trace picker ─────────────────────────────────────────────

function TracePicker({
  channels,
  onPick,
  onCancel,
}: {
  channels: ChannelDef[];
  onPick: (channel: string, field: string) => void;
  onCancel: () => void;
}) {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const chanDef = channels.find((c) => c.channel === selectedChannel);

  return (
    <div className="border border-border-default rounded p-2 mb-2 bg-bg-tertiary">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
          {selectedChannel ? "Pick field" : "Pick channel"}
        </span>
        <button onClick={onCancel} className="text-text-tertiary hover:text-text-primary">
          <X size={12} />
        </button>
      </div>
      {!selectedChannel ? (
        <div className="flex flex-wrap gap-1">
          {channels.map((c) => (
            <button
              key={c.channel}
              onClick={() => setSelectedChannel(c.channel)}
              className="text-[10px] px-2 py-1 rounded bg-bg-secondary text-text-primary hover:bg-accent-primary/20 transition-colors"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setSelectedChannel(null)}
            className="text-[9px] text-accent-primary hover:underline self-start mb-0.5"
          >
            ← Back to channels
          </button>
          <div className="flex flex-wrap gap-1">
            {chanDef?.fields.map((f) => (
              <button
                key={f.key}
                onClick={() => onPick(selectedChannel, f.key)}
                className="text-[10px] px-2 py-1 rounded bg-bg-secondary text-text-primary hover:bg-accent-primary/20 transition-colors"
              >
                {f.label}
                {f.unit && <span className="text-text-tertiary ml-0.5">({f.unit})</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── uPlot chart wrapper ──────────────────────────────────────

function UPlotChart({
  frames,
  traces,
}: {
  frames: TelemetryFrame[];
  traces: TraceConfig[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const { times, values } = useMemo(
    () => extractTraceData(frames, traces),
    [frames, traces],
  );

  useEffect(() => {
    if (!containerRef.current || times.length === 0) return;

    const el = containerRef.current;
    const width = el.clientWidth || 600;

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
      height: 220,
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

    const data: uPlot.AlignedData = [times, ...values] as unknown as uPlot.AlignedData;

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
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: 220 });
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
