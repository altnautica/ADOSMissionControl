"use client";

import { cn } from "@/lib/utils";

interface BatteryBarProps {
  /** Remaining charge in percent; null (or a non-finite value) when unknown. */
  percentage: number | null;
  className?: string;
  showLabel?: boolean;
}

/**
 * Battery charge bar. An unknown reading renders a neutral empty track labelled
 * "--", never a red 0 %: missing data must not read as a flat battery.
 */
export function BatteryBar({ percentage, className, showLabel = true }: BatteryBarProps) {
  const known = percentage !== null && Number.isFinite(percentage);
  const clamped = known ? Math.max(0, Math.min(100, percentage)) : 0;
  const color =
    clamped > 50 ? "bg-status-success" : clamped > 25 ? "bg-status-warning" : "bg-status-error";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex-1 h-2 bg-bg-tertiary border border-border-default">
        {known && (
          <div className={cn("h-full transition-all duration-500", color)} style={{ width: `${clamped}%` }} />
        )}
      </div>
      {showLabel && (
        <span className="text-[10px] font-mono text-text-secondary tabular-nums w-8 text-right">
          {known ? `${Math.round(clamped)}%` : "--"}
        </span>
      )}
    </div>
  );
}
