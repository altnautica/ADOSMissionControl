"use client";

import { useMemo } from "react";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import type { VibrationData } from "@/lib/types";

const THRESHOLD_WARNING = 30; // m/s/s
const THRESHOLD_CRITICAL = 60; // m/s/s
const MAX_DISPLAY = 90; // m/s/s
const SPARKLINE_W = 80;
const SPARKLINE_H = 16;

interface Axis {
  label: string;
  key: "vibrationX" | "vibrationY" | "vibrationZ";
  strokeColor: string;
}

const AXES: Axis[] = [
  { label: "X", key: "vibrationX", strokeColor: "#ef4444" },
  { label: "Y", key: "vibrationY", strokeColor: "#22c55e" },
  { label: "Z", key: "vibrationZ", strokeColor: "#3b82f6" },
];

function getColor(value: number): string {
  if (value < THRESHOLD_WARNING) return "bg-status-success";
  if (value < THRESHOLD_CRITICAL) return "bg-status-warning";
  return "bg-status-error";
}

function buildSparklinePoints(samples: VibrationData[], key: keyof Pick<VibrationData, "vibrationX" | "vibrationY" | "vibrationZ">): string {
  if (samples.length < 2) return "";
  const max = MAX_DISPLAY;
  const step = SPARKLINE_W / (samples.length - 1);
  return samples
    .map((s, i) => {
      const x = i * step;
      const y = SPARKLINE_H - Math.min(s[key] / max, 1) * SPARKLINE_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * XYZ vibration gauges with warning/critical threshold lines
 * and a 30-minute sparkline history. Only a fresh sample is drawn: vibration
 * that stopped arriving reads as no data, never as its last level.
 */
export function VibrationGauges({ className }: { className?: string }) {
  const vibration = useTelemetryStore((s) => s.vibration);
  // Keyed on the newest VIBRATION sample, which arrives at 1-2 Hz, not on the
  // store-wide version that bumps for every telemetry channel.
  const newestAt = useTelemetryStore((s) => s.vibration.latest()?.timestamp ?? 0);
  const latest = useFreshTelemetry("vibration");

  const sparklines = useMemo(() => {
    const samples = vibration.toArray();
    if (samples.length < 2) return null;
    return {
      x: buildSparklinePoints(samples, "vibrationX"),
      y: buildSparklinePoints(samples, "vibrationY"),
      z: buildSparklinePoints(samples, "vibrationZ"),
    };
    // newestAt is the change signal for the mutable ring buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibration, newestAt]);

  if (!latest) {
    const heard = vibration.latest() !== undefined;
    return (
      <div
        className={cn("text-[10px]", heard ? "text-status-error" : "text-text-tertiary", className)}
        data-telemetry-stale={heard || undefined}
      >
        {heard ? "Vibration · no current data" : "No vibration data"}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {AXES.map(({ label, key, strokeColor }) => {
        const value = latest[key];
        const pct = Math.min((value / MAX_DISPLAY) * 100, 100);
        const warnPct = (THRESHOLD_WARNING / MAX_DISPLAY) * 100;
        const critPct = (THRESHOLD_CRITICAL / MAX_DISPLAY) * 100;

        return (
          <Tooltip key={key} content={`Vibration ${label}: ${value.toFixed(1)} m/s/s (warn: ${THRESHOLD_WARNING}, crit: ${THRESHOLD_CRITICAL})`}>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-text-tertiary w-3">{label}</span>
              <div className="flex-1 h-2 bg-bg-tertiary/50 rounded-full overflow-hidden relative">
                {/* Threshold markers */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-status-warning/40"
                  style={{ left: `${warnPct}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-px bg-status-error/40"
                  style={{ left: `${critPct}%` }}
                />
                {/* Value bar */}
                <div
                  className={cn("h-full rounded-full transition-all", getColor(value))}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-text-tertiary w-10 tabular-nums text-right">
                {value.toFixed(1)}
              </span>
            </div>
          </Tooltip>
        );
      })}

      {/* Vibration sparkline history */}
      {sparklines && (
        <div className="pt-1 border-t border-border-default/30">
          <div className="text-[9px] font-mono text-text-tertiary mb-0.5">Vibration Trend</div>
          <svg
            width={SPARKLINE_W}
            height={SPARKLINE_H}
            viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
            className="bg-bg-tertiary/30 rounded"
          >
            {/* Warning threshold line */}
            <line
              x1="0"
              y1={SPARKLINE_H - (THRESHOLD_WARNING / MAX_DISPLAY) * SPARKLINE_H}
              x2={SPARKLINE_W}
              y2={SPARKLINE_H - (THRESHOLD_WARNING / MAX_DISPLAY) * SPARKLINE_H}
              stroke="#eab308"
              strokeWidth="0.5"
              strokeDasharray="2,2"
              opacity="0.4"
            />
            {AXES.map(({ key, strokeColor: sc }) => {
              const points = sparklines[key.replace("vibration", "").toLowerCase() as "x" | "y" | "z"];
              if (!points) return null;
              return (
                <polyline
                  key={key}
                  points={points}
                  fill="none"
                  stroke={sc}
                  strokeWidth="1"
                  opacity="0.8"
                />
              );
            })}
          </svg>
        </div>
      )}

      {/* Clipping counters */}
      <div className="flex gap-2 text-[9px] font-mono text-text-tertiary">
        <span>Clip: {latest.clipping0}/{latest.clipping1}/{latest.clipping2}</span>
      </div>
    </div>
  );
}
