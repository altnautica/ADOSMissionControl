"use client";

import { cn } from "@/lib/utils";
import { CheckCircle, XCircle } from "lucide-react";
import type { CompassProgressEntry, CompassResultEntry } from "./CalibrationWizard";

// ── Fitness helpers (aligned with QGC) ──────────────────

function fitnessColor(fitness: number): string {
  if (fitness < 8) return "text-status-success";
  if (fitness < 16) return "text-status-warning";
  if (fitness < 32) return "text-accent-primary";
  return "text-status-error";
}

function fitnessLabel(fitness: number): string {
  if (fitness < 8) return "Excellent";
  if (fitness < 16) return "Good";
  if (fitness < 32) return "Acceptable";
  return "Poor";
}

function fitnessBgColor(fitness: number): string {
  if (fitness < 8) return "bg-status-success";
  if (fitness < 16) return "bg-status-warning";
  if (fitness < 32) return "bg-accent-primary";
  return "bg-status-error";
}

// ── Offset coloring (Mission Planner pattern) ────────────

function offsetMagnitude(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function offsetColor(x: number, y: number, z: number): string {
  const mag = offsetMagnitude(x, y, z);
  if (mag < 400) return "text-status-success";
  if (mag < 600) return "text-status-warning";
  return "text-status-error";
}

function diagColor(v: number): string {
  if (v >= 0.7 && v <= 1.3) return "text-status-success";
  if (v >= 0.5 && v <= 1.5) return "text-status-warning";
  return "text-status-error";
}

function offdiagColor(v: number): string {
  const abs = Math.abs(v);
  if (abs < 0.1) return "text-status-success";
  if (abs < 0.3) return "text-status-warning";
  return "text-status-error";
}

// ── Rotation hint from the body angular rate (x roll, y pitch, z yaw) ──

function getRotationHint(direction: { x: number; y: number; z: number }): string | null {
  const { x, y, z } = direction;
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (mag < 0.3) return null;
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (az >= ax && az >= ay) return z > 0 ? "Yaw RIGHT" : "Yaw LEFT";
  if (ay >= ax && ay >= az) return y > 0 ? "Tilt nose UP" : "Tilt nose DOWN";
  return x > 0 ? "Roll RIGHT" : "Roll LEFT";
}

// MAG_CAL_STATUS values.
function calStatusText(status: number): string {
  switch (status) {
    case 0: return "Not started";
    case 1: return "Waiting to start...";
    case 2: return "Collecting samples...";
    case 3: return "Refining fit...";
    case 4: return "Calibration successful";
    case 5: return "Failed — fit did not converge";
    case 6: return "Failed — orientation mismatch";
    case 7: return "Failed — field radius out of range";
    case 8: return "Failed — offsets too large";
    case 9: return "Failed — scaling out of range";
    case 10: return "Failed — fit residuals too high";
    default: return `Status ${status}`;
  }
}

function countSectors(mask: number[]): number {
  let count = 0;
  for (const byte of mask) { let bits = byte; while (bits) { count += bits & 1; bits >>= 1; } }
  return count;
}

// ── Sphere Coverage Grid (10 rows x 8 cols = 80 sectors) ──

function SphereGrid({ mask }: { mask: number[] }) {
  const sectors: boolean[] = [];
  for (let row = 0; row < 10; row++) {
    const byte = mask[row] ?? 0;
    for (let bit = 0; bit < 8; bit++) sectors.push((byte & (1 << bit)) !== 0);
  }
  const covered = sectors.filter(Boolean).length;
  return (
    <div>
      <div className="grid grid-cols-8 gap-[1px]" style={{ width: 88 }}>
        {sectors.map((filled, i) => (
          <div key={i} className={cn("w-[10px] h-[10px] transition-colors duration-200", filled ? "bg-accent-primary" : "bg-bg-tertiary")} />
        ))}
      </div>
      <span className="text-[9px] font-mono text-text-tertiary mt-1 block">{covered}/80 sectors</span>
    </div>
  );
}

function FitnessGauge({ fitness }: { fitness: number }) {
  const maxVal = 40;
  const pct = Math.min(100, (fitness / maxVal) * 100);
  const greenEnd = (8 / maxVal) * 100;
  const yellowEnd = (16 / maxVal) * 100;
  return (
    <div className="w-full">
      <div className="relative h-3 w-full flex">
        <div className="h-full bg-status-success/40" style={{ width: `${greenEnd}%` }} />
        <div className="h-full bg-status-warning/40" style={{ width: `${yellowEnd - greenEnd}%` }} />
        <div className="h-full bg-status-error/40" style={{ width: `${100 - yellowEnd}%` }} />
        <div className={cn("absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-bg-primary", fitnessBgColor(fitness))}
          style={{ left: `${Math.min(pct, 98)}%`, transform: "translate(-50%, -50%)" }} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[8px] font-mono text-text-tertiary">0</span>
        <span className="text-[8px] font-mono text-text-tertiary">8</span>
        <span className="text-[8px] font-mono text-text-tertiary">16</span>
        <span className="text-[8px] font-mono text-text-tertiary">40+</span>
      </div>
    </div>
  );
}

// ── Compass Progress Display ────────────────────────────

export function CompassProgressDisplay({ entries }: { entries: CompassProgressEntry[] }) {
  return (
    <div className="mb-3 space-y-3">
      {entries.map(({ compassId, completionPct, calStatus: cs, completionMask, direction }) => {
        const hint = getRotationHint(direction);
        const sectors = countSectors(completionMask);
        return (
          <div key={compassId}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-mono text-text-secondary">Compass {compassId}</span>
              <span className="text-[10px] font-mono text-text-tertiary">{calStatusText(cs)} — {Math.round(completionPct)}%</span>
            </div>
            <div className="h-1.5 bg-bg-tertiary w-full">
              <div className="h-full bg-accent-primary transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, completionPct))}%` }} />
            </div>
            <div className="flex items-start justify-between gap-3 mt-1.5">
              <div className="min-h-[16px]">
                {hint && <span className="text-[10px] font-medium text-accent-primary">{hint}</span>}
                <span className="text-[9px] font-mono text-text-tertiary ml-2">{sectors}/80 sectors</span>
              </div>
              {completionMask.length > 0 && <SphereGrid mask={completionMask} />}
            </div>
            <div className="mt-1.5">
              <p className="text-[9px] font-mono text-text-tertiary uppercase tracking-wide mb-1">Angular rate (rad/s)</p>
              <div className="space-y-0.5">
                {(["x", "y", "z"] as const).map((axis) => {
                  const val = direction[axis];
                  const pct = Math.min(100, (Math.abs(val) / 3.0) * 100);
                  const axisLabel = axis === "x" ? "Roll" : axis === "y" ? "Pitch" : "Yaw";
                  return (
                    <div key={axis} className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono text-text-tertiary w-7">{axisLabel}</span>
                      <div className="h-1 bg-bg-tertiary flex-1 relative">
                        <div className={cn("h-full transition-all duration-150", val > 0 ? "bg-accent-primary" : "bg-status-warning")} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-text-tertiary w-10 text-right">{val.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Compass Results Display ─────────────────────────────

export function CompassResultsDisplay({ results }: { results: CompassResultEntry[] }) {
  return (
    <div className="mb-3 space-y-2">
      {results.map((r) => {
        const mag = offsetMagnitude(r.ofsX, r.ofsY, r.ofsZ);
        const passed = r.calStatus === 4;
        const failed = r.calStatus >= 5;
        return (
          <div key={r.compassId} className="bg-bg-tertiary/50 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-text-primary font-medium">Compass {r.compassId}</span>
                {passed && <CheckCircle size={12} className="text-status-success" />}
                {failed && <XCircle size={12} className="text-status-error" />}
              </div>
              <span className={cn("text-[10px] font-mono font-medium", fitnessColor(r.fitness))}>{fitnessLabel(r.fitness)} ({r.fitness.toFixed(1)})</span>
            </div>
            <FitnessGauge fitness={r.fitness} />
            <div>
              <p className="text-[9px] font-mono text-text-tertiary uppercase tracking-wide mb-0.5">Hard-iron offsets</p>
              <div className={cn("text-[10px] font-mono", offsetColor(r.ofsX, r.ofsY, r.ofsZ))}>
                X={r.ofsX.toFixed(1)} Y={r.ofsY.toFixed(1)} Z={r.ofsZ.toFixed(1)}
                <span className="text-text-tertiary ml-1">(|{Math.round(mag)}|)</span>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-mono text-text-tertiary uppercase tracking-wide mb-0.5">Soft-iron diagonal</p>
              <div className="text-[10px] font-mono flex gap-2">
                <span className={diagColor(r.diagX)}>X={r.diagX.toFixed(3)}</span>
                <span className={diagColor(r.diagY)}>Y={r.diagY.toFixed(3)}</span>
                <span className={diagColor(r.diagZ)}>Z={r.diagZ.toFixed(3)}</span>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-mono text-text-tertiary uppercase tracking-wide mb-0.5">Soft-iron off-diagonal</p>
              <div className="text-[10px] font-mono flex gap-2">
                <span className={offdiagColor(r.offdiagX)}>X={r.offdiagX.toFixed(3)}</span>
                <span className={offdiagColor(r.offdiagY)}>Y={r.offdiagY.toFixed(3)}</span>
                <span className={offdiagColor(r.offdiagZ)}>Z={r.offdiagZ.toFixed(3)}</span>
              </div>
            </div>
            {r.orientationConfidence > 0 && (
              <div className="text-[10px] font-mono text-text-tertiary">Orientation confidence: {(r.orientationConfidence * 100).toFixed(0)}%</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
