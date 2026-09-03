"use client";

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number; // 0-100
  color?: string;
  showLabel?: boolean;
  className?: string;
  /** Accessible name. A bare bar with no label conveys its whole meaning
   * through width and colour, so a screen reader gets nothing at all. */
  label?: string;
}

export function ProgressBar({ value, color, showLabel, className, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const defaultColor =
    clamped > 50
      ? "var(--alt-status-success)"
      : clamped > 25
        ? "var(--alt-status-warning)"
        : "var(--alt-status-error)";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="flex-1 h-1.5 bg-bg-tertiary"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${Math.round(clamped)}%`}
        aria-label={label}
      >
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: color || defaultColor }}
        />
      </div>
      {showLabel && (
        <span className="text-[10px] font-mono text-text-secondary tabular-nums w-8 text-right">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
}
