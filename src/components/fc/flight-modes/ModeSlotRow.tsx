"use client";

import { useMemo } from "react";
import { Select } from "@/components/ui/select";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODE_DESCRIPTIONS } from "./flight-mode-constants";
import type { ModeSlotConfig } from "./flight-mode-constants";
import type { UnifiedFlightMode } from "@/lib/protocol/types";

interface ModeSlotRowProps {
  index: number;
  slot: ModeSlotConfig;
  isActive: boolean;
  isDirty: boolean;
  isCopter: boolean;
  availableModes: { value: string; label: string }[];
  range: { label: string; min: number; max: number };
  onUpdate: (idx: number, partial: Partial<ModeSlotConfig>) => void;
  onReset: (idx: number) => void;
}

export function ModeSlotRow({
  index,
  slot,
  isActive,
  isDirty,
  isCopter,
  availableModes,
  range,
  onUpdate,
  onReset,
}: ModeSlotRowProps) {
  const description = MODE_DESCRIPTIONS[slot.mode as UnifiedFlightMode];

  const modesWithDesc = useMemo(() =>
    availableModes.map(m => ({
      ...m,
      description: MODE_DESCRIPTIONS[m.value as UnifiedFlightMode],
    })),
    [availableModes]
  );

  return (
    <div
      className={cn(
        "bg-bg-secondary border p-3 transition-colors",
        isDirty && "border-l-2 border-l-status-warning",
        isActive
          ? "border-accent-primary bg-accent-primary/5"
          : "border-border-default",
      )}
    >
      <div className="flex items-center gap-3">
        {/* Slot number */}
        <div
          className={cn(
            "w-7 h-7 flex items-center justify-center text-xs font-mono font-bold shrink-0",
            isActive
              ? "bg-accent-primary text-accent-foreground"
              : "bg-bg-tertiary text-text-secondary",
          )}
        >
          {index + 1}
        </div>

        {/* Mode selector */}
        <div className="flex-1">
          <Select
            value={slot.mode}
            onChange={(v) => onUpdate(index, { mode: v })}
            options={modesWithDesc}
          />
        </div>

        {/* Simple / Super Simple checkboxes (copter only) */}
        {isCopter && (
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer" title="Simple Mode — earth-relative heading">
              <input
                type="checkbox"
                checked={slot.simple}
                onChange={(e) => onUpdate(index, { simple: e.target.checked })}
                className="accent-accent-primary"
              />
              S
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer" title="Super Simple Mode — home-relative heading">
              <input
                type="checkbox"
                checked={slot.superSimple}
                onChange={(e) => onUpdate(index, { superSimple: e.target.checked })}
                className="accent-accent-primary"
              />
              SS
            </label>
          </div>
        )}

        {/* PWM range */}
        <span className="text-[10px] font-mono text-text-tertiary shrink-0 w-28 text-right">
          {range.label}
        </span>

        {/* Reset button (only when dirty) */}
        {isDirty && (
          <button
            onClick={() => onReset(index)}
            title="Reset to FC values"
            className="text-text-tertiary hover:text-text-primary cursor-pointer shrink-0"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* Description */}
      {description && (
        <p className="text-[10px] text-text-tertiary mt-1.5 ml-10">
          {description}
        </p>
      )}

      {/* Active indicator */}
      {isActive && (
        <div className="mt-2 ml-10">
          <span className="text-[10px] font-medium text-accent-primary uppercase tracking-wider">
            Active
          </span>
        </div>
      )}
    </div>
  );
}
