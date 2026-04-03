"use client";

/**
 * @module SbcNode
 * @description Central SBC node showing board info and live system stats.
 * @license GPL-3.0-only
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

interface SbcNodeData {
  boardName: string;
  soc: string;
  arch: string;
  tier: number;
  version: string;
  uptimeSeconds: number;
  fcConnected: boolean;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  temperature: number | null;
  [key: string]: unknown;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function StatBadge({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  if (value === null || value === undefined) return null;
  const color =
    value > 85
      ? "text-status-error"
      : value > 65
        ? "text-status-warning"
        : "text-status-success";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn("text-xs font-mono font-semibold", color)}>
        {Math.round(value)}{unit}
      </span>
      <span className="text-[9px] text-text-tertiary uppercase">{label}</span>
    </div>
  );
}

export function SbcNode({ data }: NodeProps) {
  const d = data as unknown as SbcNodeData;

  return (
    <div className="w-[280px] rounded-lg border border-border-default bg-bg-secondary shadow-lg overflow-hidden">
      {/* Blue accent top border */}
      <div className="h-1 bg-accent-primary" />

      <div className="p-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{d.boardName || "SBC"}</h3>
            <p className="text-[10px] text-text-tertiary font-mono">
              {d.soc} / {d.arch}
            </p>
          </div>
          <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-accent-primary/15 text-accent-primary">
            Tier {d.tier}
          </span>
        </div>

        {/* Live stats row */}
        <div className="flex items-center justify-between px-1">
          <StatBadge label="CPU" value={d.cpuPercent} unit="%" />
          <StatBadge label="MEM" value={d.memoryPercent} unit="%" />
          <StatBadge label="Disk" value={d.diskPercent} unit="%" />
          {d.temperature !== null && d.temperature !== undefined && (
            <StatBadge label="Temp" value={d.temperature} unit="C" />
          )}
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between pt-1 border-t border-border-default">
          <span className="text-[10px] text-text-tertiary">
            v{d.version} | {formatUptime(d.uptimeSeconds)}
          </span>
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                d.fcConnected ? "bg-status-success" : "bg-text-tertiary"
              )}
            />
            <span className="text-[10px] text-text-secondary">
              {d.fcConnected ? "FC Connected" : "No FC"}
            </span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-accent-primary !w-2 !h-2 !border-0" />
    </div>
  );
}
