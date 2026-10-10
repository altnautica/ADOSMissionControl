"use client";

/**
 * @module cockpit/confirm/HoldControl
 * @description The on-screen press-and-hold control of a confirm sheet. The
 * fill runs left to right over exactly the hold time while any hold source is
 * held (pointer, Enter, gamepad button) and snaps back when released, so the
 * operator always sees how much of the hold remains.
 * @license GPL-3.0-only
 */

import type { ConfirmHold } from "./use-confirm-hold";
import { cn } from "@/lib/utils";

interface HoldControlProps {
  hold: ConfirmHold;
  holdMs: number;
  label: string;
  hint: string;
  danger: boolean;
  disabled: boolean;
}

export function HoldControl({
  hold,
  holdMs,
  label,
  hint,
  danger,
  disabled,
}: HoldControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-hold-control="true"
        data-holding={hold.holding ? "true" : "false"}
        aria-disabled={disabled}
        aria-describedby="skill-confirm-hold-hint"
        {...hold.pointerHandlers}
        // Activation happens only through the hold; a click alone does nothing.
        onClick={(e) => e.preventDefault()}
        className={cn(
          "relative h-12 w-full touch-none select-none overflow-hidden rounded-md border text-sm font-semibold uppercase tracking-wide",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
          danger
            ? "border-status-error text-status-error"
            : "border-accent-primary text-accent-primary",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0",
            danger ? "bg-status-error/30" : "bg-accent-primary/30",
          )}
          style={{
            width: hold.holding ? "100%" : "0%",
            transition: hold.holding ? `width ${holdMs}ms linear` : "width 200ms ease-out",
          }}
        />
        <span className="relative">{label}</span>
      </button>
      <span id="skill-confirm-hold-hint" className="text-[11px] text-text-tertiary">
        {hint}
      </span>
    </div>
  );
}
