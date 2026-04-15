"use client";

/**
 * @module DataUsageBar
 * @description Phase 3 horizontal data usage bar for the 4G modem card.
 * Color-coded by the agent's DataCapState: green below 80%, yellow 80 to 95%,
 * orange 95 to 100%, red at or above 100%.
 * @license GPL-3.0-only
 */

import { cn } from "@/lib/utils";

type DataCapState = "ok" | "warn_80" | "throttle_95" | "blocked_100";

interface DataUsageBarProps {
  usedMb: number;
  capMb: number;
  state: DataCapState;
}

function formatGb(mb: number): string {
  const gb = mb / 1024;
  if (gb >= 10) return gb.toFixed(1) + " GB";
  return gb.toFixed(2) + " GB";
}

function colorForState(state: DataCapState): string {
  if (state === "blocked_100") return "bg-status-error";
  if (state === "throttle_95") return "bg-orange-500";
  if (state === "warn_80") return "bg-status-warning";
  return "bg-status-success";
}

export function DataUsageBar({ usedMb, capMb, state }: DataUsageBarProps) {
  const pct = capMb > 0 ? Math.min(100, (usedMb / capMb) * 100) : 0;
  const widthPct = Math.max(0, Math.min(100, pct));
  const barColor = colorForState(state);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-secondary">
          {formatGb(usedMb)} of {formatGb(capMb)}
        </span>
        <span className="font-mono text-text-primary">
          {widthPct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-bg-tertiary">
        <div
          className={cn("h-full transition-all", barColor)}
          style={{ width: widthPct + "%" }}
        />
      </div>
    </div>
  );
}
