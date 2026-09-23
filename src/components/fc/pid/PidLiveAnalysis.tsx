"use client";

import { useMemo } from "react";
import { Activity, Waves, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { TELEMETRY_STALE_MS, freshOnly } from "@/lib/telemetry/freshness";
import type { AttitudeData, VibrationData } from "@/lib/types";

interface PidLiveAnalysisProps {
  connected: boolean;
}

const RAD_TO_DEG = 180 / Math.PI;

/** Body-rate standard deviation above which the strip flags oscillation. */
export const OSCILLATION_THRESHOLD_DEG_S = 10;

function computeRms(values: number[]): number {
  if (values.length === 0) return 0;
  const sumSq = values.reduce((s, v) => s + v * v, 0);
  return Math.sqrt(sumSq / values.length);
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export type VibeLevel = "good" | "marginal" | "bad" | "unknown";

function vibeLevel(vibe: VibrationData | undefined): VibeLevel {
  if (!vibe) return "unknown";
  const max = Math.max(vibe.vibrationX, vibe.vibrationY, vibe.vibrationZ);
  if (max < 15) return "good";
  if (max < 30) return "marginal";
  return "bad";
}

const VIBE_DISPLAY: Record<VibeLevel, { label: string; color: string }> = {
  good: { label: "Good", color: "text-status-success" },
  marginal: { label: "Marginal", color: "text-status-warning" },
  bad: { label: "Bad", color: "text-status-error" },
  unknown: { label: "\u2014", color: "text-text-tertiary" },
};

export interface LivePidStats {
  /** Body-rate RMS per axis, deg/s. */
  rollRms: number;
  pitchRms: number;
  yawRms: number;
  hasOscillation: boolean;
  vibe: VibeLevel;
  hasData: boolean;
}

/**
 * Stats over the attitude samples of the last `TELEMETRY_STALE_MS`.
 * ATTITUDE body rates arrive in rad/s and are converted to deg/s here.
 * Samples older than the window are ignored, so a lost link empties the
 * strip instead of freezing it; a vehicle that sends no VIBRATION shows an
 * unknown vibration level rather than "Good".
 */
export function computeLivePidStats(
  attitude: readonly AttitudeData[],
  latestVibration: VibrationData | undefined,
  now: number,
): LivePidStats {
  const cutoff = now - TELEMETRY_STALE_MS;
  const recent = attitude.filter((a) => a.timestamp >= cutoff);
  const roll = recent.map((a) => a.rollSpeed * RAD_TO_DEG);
  const pitch = recent.map((a) => a.pitchSpeed * RAD_TO_DEG);
  const yaw = recent.map((a) => a.yawSpeed * RAD_TO_DEG);
  return {
    rollRms: computeRms(roll),
    pitchRms: computeRms(pitch),
    yawRms: computeRms(yaw),
    hasOscillation:
      computeStdDev(roll) > OSCILLATION_THRESHOLD_DEG_S ||
      computeStdDev(pitch) > OSCILLATION_THRESHOLD_DEG_S ||
      computeStdDev(yaw) > OSCILLATION_THRESHOLD_DEG_S,
    vibe: vibeLevel(freshOnly(latestVibration, now)),
    hasData: recent.length > 0,
  };
}

export function PidLiveAnalysis({ connected }: PidLiveAnalysisProps) {
  const attitudeRing = useTelemetryStore((s) => s.attitude);
  const vibrationRing = useTelemetryStore((s) => s.vibration);
  const tick = useClockTick();

  const stats = useMemo(
    () => computeLivePidStats(attitudeRing.toArray(), vibrationRing.latest(), Date.now()),
    // The ring buffers mutate in place; the shared clock re-samples them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, attitudeRing, vibrationRing],
  );

  const vibe = VIBE_DISPLAY[stats.vibe];

  if (!connected || !stats.hasData) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-bg-tertiary/30 border border-border-default">
        <Activity size={12} className="text-text-tertiary" />
        <span className="text-[10px] text-text-tertiary">
          {connected ? "Waiting for telemetry data..." : "No telemetry data"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-bg-tertiary/30 border border-border-default overflow-x-auto">
      {([
        ["Roll", stats.rollRms],
        ["Pitch", stats.pitchRms],
        ["Yaw", stats.yawRms],
      ] as const).map(([label, rms]) => (
        <div key={label} className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-text-tertiary">{label}</span>
            <span className="text-[10px] font-mono text-text-primary">{rms.toFixed(1)}</span>
            <span className="text-[8px] text-text-tertiary">deg/s</span>
          </div>
          <div className="w-px h-4 bg-border-default" />
        </div>
      ))}

      {/* Vibration */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Waves size={10} className="text-text-tertiary" />
        <span className={cn("text-[10px] font-mono", vibe.color)}>{vibe.label}</span>
      </div>

      {stats.hasOscillation && (
        <>
          <div className="w-px h-4 bg-border-default shrink-0" />
          <div className="flex items-center gap-1 shrink-0">
            <AlertTriangle size={10} className="text-status-warning" />
            <span className="text-[9px] text-status-warning">Oscillation</span>
          </div>
        </>
      )}
    </div>
  );
}
