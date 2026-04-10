"use client";

/**
 * Correlation Panel — pick X and Y fields, render scatter plot + Pearson r.
 *
 * Phase 17b — advanced analytics.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState, useRef, useEffect } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Card } from "@/components/ui/card";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

// ── Field registry (shared with CustomChartBuilder) ──────────

interface PickerField {
  channel: string;
  channelLabel: string;
  key: string;
  label: string;
  unit?: string;
}

const FIELDS: PickerField[] = [
  { channel: "position", channelLabel: "Position", key: "relativeAlt", label: "Rel Alt", unit: "m" },
  { channel: "position", channelLabel: "Position", key: "groundSpeed", label: "Ground Speed", unit: "m/s" },
  { channel: "position", channelLabel: "Position", key: "climbRate", label: "Climb Rate", unit: "m/s" },
  { channel: "attitude", channelLabel: "Attitude", key: "roll", label: "Roll", unit: "°" },
  { channel: "attitude", channelLabel: "Attitude", key: "pitch", label: "Pitch", unit: "°" },
  { channel: "attitude", channelLabel: "Attitude", key: "yaw", label: "Yaw", unit: "°" },
  { channel: "battery", channelLabel: "Battery", key: "voltage", label: "Voltage", unit: "V" },
  { channel: "battery", channelLabel: "Battery", key: "current", label: "Current", unit: "A" },
  { channel: "battery", channelLabel: "Battery", key: "remaining", label: "Remaining", unit: "%" },
  { channel: "vfr", channelLabel: "VFR", key: "throttle", label: "Throttle", unit: "%" },
  { channel: "vfr", channelLabel: "VFR", key: "groundspeed", label: "Ground Speed", unit: "m/s" },
  { channel: "vfr", channelLabel: "VFR", key: "climb", label: "Climb", unit: "m/s" },
  { channel: "gps", channelLabel: "GPS", key: "satellites", label: "Satellites" },
  { channel: "gps", channelLabel: "GPS", key: "hdop", label: "HDOP" },
  { channel: "vibration", channelLabel: "Vibration", key: "vibrationX", label: "Vib X", unit: "m/s²" },
  { channel: "vibration", channelLabel: "Vibration", key: "vibrationY", label: "Vib Y", unit: "m/s²" },
  { channel: "vibration", channelLabel: "Vibration", key: "vibrationZ", label: "Vib Z", unit: "m/s²" },
  { channel: "ekf", channelLabel: "EKF", key: "velocityVariance", label: "Vel Var" },
  { channel: "ekf", channelLabel: "EKF", key: "posHorizVariance", label: "Pos H Var" },
];

const RAD_TO_DEG = 180 / Math.PI;

function extractField(
  frames: TelemetryFrame[],
  channel: string,
  key: string,
): { t: number; v: number }[] {
  const pts: { t: number; v: number }[] = [];
  for (const f of frames) {
    if (f.channel !== channel) continue;
    const d = f.data as Record<string, unknown>;
    let raw = typeof d[key] === "number" ? (d[key] as number) : undefined;
    if (raw === undefined || !isFinite(raw)) continue;
    // Attitude rads → deg
    if (channel === "attitude" && Math.abs(raw) < 6.3) raw *= RAD_TO_DEG;
    pts.push({ t: f.offsetMs, v: raw });
  }
  return pts;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

interface CorrelationPanelProps {
  frames: TelemetryFrame[];
}

export function CorrelationPanel({ frames }: CorrelationPanelProps) {
  const availableFields = useMemo(() => {
    const chans = new Set(frames.map((f) => f.channel));
    return FIELDS.filter((f) => chans.has(f.channel));
  }, [frames]);

  const [xField, setXField] = useState<PickerField | null>(null);
  const [yField, setYField] = useState<PickerField | null>(null);

  // Align X and Y by nearest time (within 100ms tolerance).
  const { xVals, yVals } = useMemo(() => {
    if (!xField || !yField) return { xVals: [] as number[], yVals: [] as number[] };
    const xPts = extractField(frames, xField.channel, xField.key);
    const yPts = extractField(frames, yField.channel, yField.key);
    if (xPts.length === 0 || yPts.length === 0) return { xVals: [], yVals: [] };

    // Match by nearest time
    const xOut: number[] = [];
    const yOut: number[] = [];
    let yIdx = 0;
    for (const xp of xPts) {
      while (yIdx < yPts.length - 1 && Math.abs(yPts[yIdx + 1].t - xp.t) < Math.abs(yPts[yIdx].t - xp.t)) {
        yIdx++;
      }
      if (Math.abs(yPts[yIdx].t - xp.t) < 200) {
        xOut.push(xp.v);
        yOut.push(yPts[yIdx].v);
      }
    }
    return { xVals: xOut, yVals: yOut };
  }, [frames, xField, yField]);

  const r = useMemo(() => pearson(xVals, yVals), [xVals, yVals]);

  const rColor =
    Math.abs(r) > 0.7 ? "text-status-success" : Math.abs(r) > 0.4 ? "text-status-warning" : "text-text-tertiary";

  return (
    <Card title="Correlation" padding={true}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FieldPicker label="X" value={xField} options={availableFields} onChange={setXField} />
          <span className="text-text-tertiary text-[10px]">vs</span>
          <FieldPicker label="Y" value={yField} options={availableFields} onChange={setYField} />
          {xField && yField && xVals.length > 0 && (
            <span className="text-[10px] font-mono ml-2">
              r = <span className={rColor}>{r.toFixed(4)}</span>
              <span className="text-text-tertiary ml-1">(n={xVals.length})</span>
            </span>
          )}
        </div>
        {xField && yField && xVals.length > 0 && (
          <ScatterPlot
            xVals={xVals}
            yVals={yVals}
            xLabel={`${xField.channelLabel} · ${xField.label}${xField.unit ? ` (${xField.unit})` : ""}`}
            yLabel={`${yField.channelLabel} · ${yField.label}${yField.unit ? ` (${yField.unit})` : ""}`}
          />
        )}
        {xField && yField && xVals.length === 0 && (
          <p className="text-[10px] text-text-tertiary py-4 text-center">
            No overlapping samples. Try fields recorded at similar rates.
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Field picker ─────────────────────────────────────────────

function FieldPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: PickerField | null;
  options: PickerField[];
  onChange: (f: PickerField) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold text-text-secondary uppercase">{label}:</span>
      <select
        className="text-[10px] bg-bg-tertiary text-text-primary border border-border-default rounded px-1.5 py-0.5 outline-none focus:border-accent-primary"
        value={value ? `${value.channel}:${value.key}` : ""}
        onChange={(e) => {
          const [ch, k] = e.target.value.split(":");
          const f = options.find((o) => o.channel === ch && o.key === k);
          if (f) onChange(f);
        }}
      >
        <option value="">Select…</option>
        {options.map((f) => (
          <option key={`${f.channel}:${f.key}`} value={`${f.channel}:${f.key}`}>
            {f.channelLabel} · {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Scatter plot via uPlot ───────────────────────────────────

function ScatterPlot({
  xVals,
  yVals,
  xLabel,
  yLabel,
}: {
  xVals: number[];
  yVals: number[];
  xLabel: string;
  yLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current || xVals.length === 0) return;
    const el = containerRef.current;
    const width = el.clientWidth || 400;

    // Downsample for rendering
    const MAX_PTS = 10_000;
    let xs = xVals;
    let ys = yVals;
    if (xs.length > MAX_PTS) {
      const step = Math.ceil(xs.length / MAX_PTS);
      xs = xs.filter((_, i) => i % step === 0);
      ys = yVals.filter((_, i) => i % step === 0);
    }

    const opts: uPlot.Options = {
      width,
      height: 200,
      mode: 2, // scatter
      cursor: { drag: { x: true, y: true, setScale: true } },
      scales: {
        x: { time: false },
      },
      axes: [
        {
          stroke: "#6b6b7f",
          grid: { stroke: "#1f1f2e", dash: [3, 3] },
          font: "9px JetBrains Mono, monospace",
          label: xLabel,
          labelFont: "9px JetBrains Mono, monospace",
          labelSize: 14,
        },
        {
          stroke: "#6b6b7f",
          grid: { stroke: "#1f1f2e", dash: [3, 3] },
          font: "9px JetBrains Mono, monospace",
          label: yLabel,
          labelFont: "9px JetBrains Mono, monospace",
          labelSize: 14,
          size: 52,
        },
      ],
      series: [
        {},
        {
          stroke: "#3a82ff",
          fill: "rgba(58, 130, 255, 0.15)",
          paths: () => null, // scatter — no line
          points: {
            show: true,
            size: 3,
            fill: "#3a82ff",
            stroke: "#3a82ff",
          },
        },
      ],
    };

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new uPlot(
      opts,
      [xs, ys] as unknown as uPlot.AlignedData,
      el,
    );

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [xVals, yVals, xLabel, yLabel]);

  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.setSize({ width: w, height: 200 });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [xVals]);

  return <div ref={containerRef} className="w-full" />;
}
