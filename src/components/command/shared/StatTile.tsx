"use client";

/**
 * A compact metric tile for the overview grid: an icon + label header, a big
 * mono value, an optional status dot, and an optional hint line. The base unit
 * of the unified overview design system, replacing hand-rolled metric boxes.
 *
 * @module StatTile
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { StatusLevel } from "@/lib/status-level";
import { StatusDot } from "@/components/ui/status-dot";

export function StatTile({
  icon,
  label,
  value,
  level,
  hint,
  className,
  wrapValue = false,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  level?: StatusLevel;
  hint?: ReactNode;
  className?: string;
  /** A word value (a state, not a number): smaller sans text that wraps instead of truncating. */
  wrapValue?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-between rounded-lg border border-border-default bg-bg-secondary p-3",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-tertiary">
        {icon}
        <span className="truncate">{label}</span>
        {level && <StatusDot status={level} size="xs" className="ml-auto" />}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold text-text-primary",
          wrapValue
            ? "line-clamp-2 break-words text-sm leading-tight"
            : "truncate font-mono text-lg tabular-nums",
        )}
      >
        {value}
      </div>
      {hint && <div className="truncate text-[10px] text-text-tertiary">{hint}</div>}
    </div>
  );
}
