"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { PidAnalysisResult } from "@/lib/analysis/types";

interface PidAnalysisSummaryProps {
  result: PidAnalysisResult;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-text-tertiary";
  if (score >= 80) return "text-status-success";
  if (score >= 50) return "text-status-warning";
  return "text-status-error";
}

function scoreStrokeColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function noiseLabel(noiseFloorDb: number | null): { label: string; color: string } {
  // Average noise floor across the measured axes; lower is better
  if (noiseFloorDb === null) return { label: "-", color: "text-text-tertiary" };
  if (noiseFloorDb < -40) return { label: "Good", color: "text-status-success" };
  if (noiseFloorDb < -25) return { label: "Moderate", color: "text-status-warning" };
  return { label: "High", color: "text-status-error" };
}

/** SVG circular progress ring. */
function ScoreRing({ score, size = 72, strokeWidth = 5 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#1f2937"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={scoreStrokeColor(score)}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="butt"
        className="transition-all duration-500"
      />
    </svg>
  );
}

export function PidAnalysisSummary({ result }: PidAnalysisSummaryProps) {
  const floors = [result.fft.roll, result.fft.pitch, result.fft.yaw]
    .map((axis) => axis.noiseFloorDb)
    .filter((db): db is number => db !== null);
  const avgNoiseFloor = floors.length > 0 ? floors.reduce((s, db) => s + db, 0) / floors.length : null;
  const noise = noiseLabel(avgNoiseFloor);

  const criticalCount = result.issues.filter((i) => i.severity === "critical").length;
  const warningCount = result.issues.filter((i) => i.severity === "warning").length;
  const infoCount = result.issues.filter((i) => i.severity === "info").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {/* Overall Tune Score */}
      <div className="border border-border-default bg-bg-secondary p-3 flex flex-col items-center">
        <span className="text-[9px] text-text-tertiary uppercase tracking-wide mb-2">Tune Score</span>
        <div className="relative">
          <ScoreRing score={result.tuneScore ?? 0} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn("text-lg font-bold font-mono", scoreColor(result.tuneScore))}>
              {result.tuneScore ?? "-"}
            </span>
          </div>
        </div>
      </div>

      {/* Noise Level */}
      <div className="border border-border-default bg-bg-secondary p-3 flex flex-col items-center justify-center">
        <span className="text-[9px] text-text-tertiary uppercase tracking-wide mb-1">Noise Level</span>
        <span className={cn("text-sm font-semibold", noise.color)}>{noise.label}</span>
        <span className="text-[9px] font-mono text-text-tertiary mt-0.5">
          {avgNoiseFloor === null ? "no IMU data" : `${avgNoiseFloor.toFixed(1)} dB avg`}
        </span>
      </div>

      {/* Per-axis tracking */}
      {(["roll", "pitch", "yaw"] as const).map((axis) => {
        const t = result.tracking[axis];
        return (
          <div
            key={axis}
            className="border border-border-default bg-bg-secondary p-3 flex flex-col items-center justify-center"
          >
            <span className="text-[9px] text-text-tertiary uppercase tracking-wide mb-1">{axis}</span>
            <span className={cn("text-lg font-bold font-mono", scoreColor(t.score))}>
              {t.score ?? "-"}
            </span>
            <span className="text-[9px] font-mono text-text-tertiary mt-0.5">
              {t.rmsError === null ? "no RATE data" : `${t.rmsError.toFixed(2)} deg/s RMS`}
            </span>
          </div>
        );
      })}

      {/* Issues */}
      <div className="border border-border-default bg-bg-secondary p-3 flex flex-col items-center justify-center">
        <span className="text-[9px] text-text-tertiary uppercase tracking-wide mb-1">Issues</span>
        <span className="text-lg font-bold font-mono text-text-primary">
          {result.issues.length}
        </span>
        <div className="flex items-center gap-2 mt-0.5">
          {criticalCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-status-error">
              <AlertTriangle size={9} /> {criticalCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-status-warning">
              <AlertCircle size={9} /> {warningCount}
            </span>
          )}
          {infoCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-text-tertiary">
              <Info size={9} /> {infoCount}
            </span>
          )}
          {result.issues.length === 0 && (
            <span className="text-[9px] text-status-success">All clear</span>
          )}
        </div>
      </div>
    </div>
  );
}
