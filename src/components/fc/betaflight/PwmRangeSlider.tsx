"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Betaflight mode and adjustment ranges are stored as steps of 25 µs from
 * 900 µs: PWM = 900 + step * 25, 48 steps up to 2100 µs.
 */
export const PWM_RANGE_STEPS = 48;

export function stepToPwm(step: number): number {
  return 900 + step * 25;
}

export function pwmToStep(pwm: number): number {
  return Math.round((pwm - 900) / 25);
}

/**
 * Which thumb a press at `step` grabs: the start thumb at or left of the
 * range, the end thumb at or right of it, otherwise the closer one.
 */
export function nearestThumb(step: number, start: number, end: number): "start" | "end" {
  if (step <= start) return "start";
  if (step >= end) return "end";
  return step - start < end - step ? "start" : "end";
}

/**
 * Dual-thumb PWM range editor. Pointer input is hit-tested against the track
 * and moves the nearest thumb, so both ends can be dragged; the two range
 * inputs underneath stay for keyboard use and take no pointer events.
 */
export function PwmRangeSlider({
  start,
  end,
  onChange,
  activePwm,
  dirty = false,
}: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** Live channel PWM for the position marker; undefined when no fresh RC. */
  activePwm: number | undefined;
  dirty?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const startPct = (start / PWM_RANGE_STEPS) * 100;
  const endPct = (end / PWM_RANGE_STEPS) * 100;
  const live = activePwm !== undefined && activePwm > 0 ? activePwm : undefined;
  const activePct =
    live !== undefined ? (pwmToStep(Math.min(2100, Math.max(900, live))) / PWM_RANGE_STEPS) * 100 : -1;
  const isInRange = live !== undefined && live >= stepToPwm(start) && live <= stepToPwm(end);

  const stepAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return start;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(frac * PWM_RANGE_STEPS);
  };

  const moveThumb = (thumb: "start" | "end", step: number) => {
    if (thumb === "start") {
      const v = Math.min(step, end - 1);
      if (v !== start && v >= 0) onChange(v, end);
    } else {
      const v = Math.max(step, start + 1);
      if (v !== end && v <= PWM_RANGE_STEPS) onChange(start, v);
    }
  };

  return (
    <div
      ref={trackRef}
      data-testid="pwm-range-track"
      className="relative h-8 select-none cursor-pointer touch-none"
      onPointerDown={(e) => {
        const step = stepAt(e.clientX);
        const thumb = nearestThumb(step, start, end);
        dragging.current = thumb;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        moveThumb(thumb, step);
      }}
      onPointerMove={(e) => {
        if (dragging.current) moveThumb(dragging.current, stepAt(e.clientX));
      }}
      onPointerUp={() => { dragging.current = null; }}
      onPointerCancel={() => { dragging.current = null; }}
    >
      <div className="absolute top-3 left-0 right-0 h-2 bg-bg-tertiary rounded-full" />

      <div
        className={cn(
          "absolute top-3 h-2 rounded-full transition-colors",
          dirty ? "bg-status-warning/50" : isInRange ? "bg-status-success/60" : "bg-accent-primary/40",
        )}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
      />

      {activePct >= 0 && (
        <div
          className={cn("absolute top-1.5 w-0.5 h-5 rounded-full", isInRange ? "bg-status-success" : "bg-text-tertiary")}
          style={{ left: `${activePct}%` }}
        />
      )}

      {[startPct, endPct].map((pct, i) => (
        <div
          key={i}
          className="absolute top-2 w-2 h-4 -ml-1 bg-accent-primary rounded-sm pointer-events-none"
          style={{ left: `${pct}%` }}
        />
      ))}

      <input
        type="range"
        aria-label="Range start"
        min={0}
        max={PWM_RANGE_STEPS}
        value={start}
        onChange={(e) => moveThumb("start", Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 pointer-events-none"
      />
      <input
        type="range"
        aria-label="Range end"
        min={0}
        max={PWM_RANGE_STEPS}
        value={end}
        onChange={(e) => moveThumb("end", Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 pointer-events-none"
      />

      <div className="absolute -bottom-1 left-0 right-0 flex justify-between text-[8px] text-text-tertiary font-mono pointer-events-none">
        <span>900</span>
        <span>1500</span>
        <span>2100</span>
      </div>
    </div>
  );
}
