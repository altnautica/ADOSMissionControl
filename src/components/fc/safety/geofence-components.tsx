"use client";

import { ArrowDown, ArrowUp, Circle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Card ──────────────────────────────────────────────────────

export function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent-primary">{icon}</span>
        <div>
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <p className="text-[10px] text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Fence enable / type ───────────────────────────────────────

/** ArduPilot FENCE_TYPE bits. FENCE_ENABLE itself is only 0/1. */
export const FENCE_TYPE_BITS = {
  ALT_MAX: 1 << 0,
  CIRCLE: 1 << 1,
  POLYGON: 1 << 2,
  ALT_MIN: 1 << 3,
} as const;

const FENCE_TYPE_CHIPS = [
  { bit: FENCE_TYPE_BITS.ALT_MAX, label: "Max Altitude", icon: <ArrowUp size={10} /> },
  { bit: FENCE_TYPE_BITS.CIRCLE, label: "Circle", icon: <Circle size={10} /> },
  { bit: FENCE_TYPE_BITS.POLYGON, label: "Polygon", icon: <MapPin size={10} /> },
  { bit: FENCE_TYPE_BITS.ALT_MIN, label: "Min Altitude", icon: <ArrowDown size={10} /> },
] as const;

/**
 * FENCE_TYPE as its bitmask: one chip per fence type, each toggling only its
 * own bit so the other enforced fences are never silently changed.
 */
export function FenceTypeBits({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {FENCE_TYPE_CHIPS.map(({ bit, label, icon }) => {
          const active = (value & bit) !== 0;
          return (
            <button
              key={bit}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(value ^ bit)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors",
                active
                  ? "bg-accent-primary/10 border-accent-primary text-accent-primary"
                  : "bg-bg-tertiary border-border-default text-text-tertiary hover:text-text-secondary",
              )}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] font-mono text-text-tertiary">FENCE_TYPE = {value} (0x{value.toString(16).padStart(2, "0")})</p>
    </div>
  );
}

/** FENCE_ENABLE as the 0/1 switch it is. */
export function FenceEnableToggle({ label, enabled, onChange }: {
  label: string; enabled: boolean; onChange: (next: 0 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary">{label}</span>
      <button type="button" role="switch" aria-checked={enabled} aria-label={label} onClick={() => onChange(enabled ? 0 : 1)}
        className={cn("w-10 h-5 rounded-full relative transition-colors", enabled ? "bg-accent-primary" : "bg-bg-tertiary border border-border-default")}>
        <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", enabled ? "translate-x-5" : "translate-x-0.5")} />
      </button>
      <span className="text-[10px] font-mono text-text-tertiary">{enabled ? "ENABLED" : "DISABLED"}</span>
    </div>
  );
}

// ── ParamInput ────────────────────────────────────────────────

export function ParamInput({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: React.ReactNode;
  value: number;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-secondary">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 h-7 px-1.5 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
        />
        <span className="text-[10px] text-text-tertiary">{unit}</span>
      </div>
    </div>
  );
}

// ── AltitudeBandViz ───────────────────────────────────────────

/** Visual altitude band showing the valid flight altitude range */
export function AltitudeBandViz({ altMin, altMax }: { altMin: number; altMax: number }) {
  const displayMax = Math.max(altMax, 10);
  const displayMin = Math.max(altMin, 0);
  const range = displayMax - displayMin;

  const BAR_HEIGHT = 80;
  const minPct = displayMax > 0 ? (displayMin / displayMax) * 100 : 0;
  const bandPct = displayMax > 0 ? (range / displayMax) * 100 : 100;

  return (
    <div className="flex items-start gap-3 mt-2">
      <div className="relative" style={{ width: 24, height: BAR_HEIGHT }}>
        <div
          className="absolute inset-0 bg-status-error/15 border border-status-error/20"
          style={{ borderRadius: 2 }}
        />
        <div
          className="absolute left-0 right-0 bg-status-success/25 border-l-2 border-status-success"
          style={{
            bottom: `${minPct}%`,
            height: `${bandPct}%`,
            borderRadius: 1,
          }}
        />
        <div
          className="absolute left-0 right-0 h-px bg-status-error"
          style={{ bottom: `${100}%`, transform: "translateY(1px)" }}
        />
      </div>
      <div className="flex flex-col justify-between" style={{ height: BAR_HEIGHT }}>
        <div className="text-[10px] font-mono text-status-error">
          {altMax}m MAX
        </div>
        <div className="text-[10px] font-mono text-status-success">
          Valid: {displayMin}m - {altMax}m
        </div>
        <div className="text-[10px] font-mono text-text-tertiary">
          {altMin > 0 ? `${altMin}m MIN` : "0m GND"}
        </div>
      </div>
    </div>
  );
}
