"use client";

import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import type { PidAnalysisResult } from "@/lib/analysis/types";

interface PidComparisonViewProps {
  before: PidAnalysisResult | null;
  current: PidAnalysisResult;
}

/** A null value was not measured in that analysis; it shows as "-" and no delta is drawn. */
function DeltaBadge({ before, after, label, lowerIsBetter = false }: { before: number | null; after: number | null; label: string; lowerIsBetter?: boolean }) {
  const delta = before !== null && after !== null ? after - before : null;
  const improved = delta !== null && (lowerIsBetter ? delta < 0 : delta > 0);
  const unchanged = delta === null || Math.abs(delta) < 0.5;

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border-default/50">
      <span className="text-[10px] text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-text-tertiary">{before?.toFixed(1) ?? "-"}</span>
        <ArrowRight size={10} className="text-text-tertiary" />
        <span className="text-[10px] font-mono text-text-primary">{after?.toFixed(1) ?? "-"}</span>
        {!unchanged && (
          <span
            className={cn(
              "text-[9px] font-mono px-1 py-0.5",
              improved ? "bg-status-success/20 text-status-success" : "bg-status-error/20 text-status-error",
            )}
          >
            {delta !== null && delta > 0 ? "+" : ""}{delta?.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

export function PidComparisonView({ before, current }: PidComparisonViewProps) {
  if (!before) {
    return (
      <div className="border border-border-default bg-bg-secondary p-4 text-center">
        <p className="text-xs text-text-secondary">No baseline saved yet</p>
        <p className="text-[10px] text-text-tertiary mt-1">
          Save current analysis as baseline, then re-analyze after tuning changes
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-primary">Before vs After</span>
        <div className="flex items-center gap-3 text-[9px] text-text-tertiary">
          <span>Before</span>
          <span>After</span>
        </div>
      </div>

      <DeltaBadge
        before={before.tuneScore}
        after={current.tuneScore}
        label="Overall Score"
      />
      <DeltaBadge
        before={before.tracking.roll.score}
        after={current.tracking.roll.score}
        label="Roll Tracking"
      />
      <DeltaBadge
        before={before.tracking.pitch.score}
        after={current.tracking.pitch.score}
        label="Pitch Tracking"
      />
      <DeltaBadge
        before={before.tracking.yaw.score}
        after={current.tracking.yaw.score}
        label="Yaw Tracking"
      />
      <DeltaBadge
        before={before.motors.healthScore}
        after={current.motors.healthScore}
        label="Motor Health"
      />
      <DeltaBadge
        before={before.issues.length}
        after={current.issues.length}
        label="Issues (lower = better)"
        lowerIsBetter
      />
    </div>
  );
}
