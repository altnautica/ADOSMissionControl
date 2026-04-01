"use client";

import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeckSeverity } from "./deck-types";

interface DeckCellProps {
  label: string;
  value: string;
  severity: DeckSeverity;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

export function DeckCell({
  label,
  value,
  severity,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: DeckCellProps) {
  const severityClass =
    severity === "critical"
      ? "border-status-error bg-status-error/10"
      : severity === "warning"
        ? "border-status-warning bg-status-warning/10"
        : "border-border-default bg-bg-secondary";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        "flex flex-col px-2 py-1.5 border transition-colors select-none min-w-0",
        severityClass,
        isDragging && "opacity-50",
        isDragOver && "ring-1 ring-accent-primary/70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] text-text-tertiary uppercase tracking-wide truncate">{label}</span>
        <GripVertical size={10} className="text-text-tertiary/70 shrink-0" />
      </div>
      <span className="text-[11px] font-mono font-semibold tabular-nums text-text-primary leading-tight truncate max-w-full mt-0.5">
        {value}
      </span>
    </div>
  );
}
