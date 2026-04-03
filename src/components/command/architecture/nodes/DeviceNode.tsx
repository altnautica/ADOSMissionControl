"use client";

/**
 * @module DeviceNode
 * @description Reusable device node for all peripheral types. Styled by category.
 * @license GPL-3.0-only
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

interface DeviceNodeData {
  name: string;
  category: string;
  type: string;
  bus: string;
  address: string;
  status: string;
  lastReading: string;
  rateHz: number;
  endpointCount?: number;
  [key: string]: unknown;
}

const categoryColors: Record<string, { border: string; badge: string }> = {
  sensor: {
    border: "border-l-[#3A82FF]",
    badge: "bg-[#3A82FF]/15 text-[#3A82FF]",
  },
  camera: {
    border: "border-l-[#22C55E]",
    badge: "bg-[#22C55E]/15 text-[#22C55E]",
  },
  codec: {
    border: "border-l-[#F97316]",
    badge: "bg-[#F97316]/15 text-[#F97316]",
  },
  isp: {
    border: "border-l-[#06B6D4]",
    badge: "bg-[#06B6D4]/15 text-[#06B6D4]",
  },
  decoder: {
    border: "border-l-[#EC4899]",
    badge: "bg-[#EC4899]/15 text-[#EC4899]",
  },
  compute: {
    border: "border-l-[#6B7280]",
    badge: "bg-[#6B7280]/15 text-[#6B7280]",
  },
  video: {
    border: "border-l-[#EAB308]",
    badge: "bg-[#EAB308]/15 text-[#EAB308]",
  },
  gimbal: {
    border: "border-l-[#A855F7]",
    badge: "bg-[#A855F7]/15 text-[#A855F7]",
  },
};

const defaultColors = {
  border: "border-l-[#6B7280]",
  badge: "bg-[#6B7280]/15 text-[#6B7280]",
};

const statusDot: Record<string, string> = {
  ok: "bg-status-success",
  warning: "bg-status-warning",
  error: "bg-status-error",
  offline: "bg-text-tertiary",
};

export function DeviceNode({ data }: NodeProps) {
  const d = data as unknown as DeviceNodeData;
  const colors = categoryColors[d.category] ?? defaultColors;

  return (
    <div
      className={cn(
        "w-[220px] rounded-lg border border-border-default bg-bg-secondary shadow-md overflow-hidden border-l-[3px]",
        colors.border
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent-primary !w-2 !h-2 !border-0" />

      <div className="p-2.5 space-y-1.5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-text-primary truncate flex-1">
            {d.name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <div className={cn("w-1.5 h-1.5 rounded-full", statusDot[d.status] ?? "bg-text-tertiary")} />
          </div>
        </div>

        {/* Category + bus badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("px-1.5 py-0.5 text-[9px] font-medium rounded", colors.badge)}>
            {d.category}
          </span>
          <span className="px-1.5 py-0.5 text-[9px] font-mono text-text-tertiary bg-bg-tertiary rounded">
            {d.bus}
          </span>
        </div>

        {/* Details */}
        <div className="space-y-0.5 text-[10px] text-text-tertiary">
          <div className="flex justify-between">
            <span>Address</span>
            <span className="text-text-secondary font-mono">{d.address}</span>
          </div>
          {d.rateHz > 0 && (
            <div className="flex justify-between">
              <span>Rate</span>
              <span className="text-text-secondary font-mono">{d.rateHz} Hz</span>
            </div>
          )}
          {d.endpointCount && d.endpointCount > 1 && (
            <div className="flex justify-between">
              <span>Endpoints</span>
              <span className="text-text-secondary font-mono">{d.endpointCount}</span>
            </div>
          )}
        </div>

        {/* Last reading */}
        {d.lastReading && (
          <div className="pt-1 border-t border-border-default">
            <p className="text-[9px] text-text-secondary font-mono truncate" title={d.lastReading}>
              {d.lastReading}
            </p>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-accent-primary !w-2 !h-2 !border-0" />
    </div>
  );
}
