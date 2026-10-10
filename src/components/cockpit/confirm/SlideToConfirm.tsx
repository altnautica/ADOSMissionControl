"use client";

/**
 * @module cockpit/confirm/SlideToConfirm
 * @description Slide-to-confirm for the highest-intent actions (arm, start
 * mission). Touch and pointer drag the handle to the end of the track; a key
 * or gamepad hold fills the same track over the slide hold time, so every
 * input reaches the same deliberate gesture. Releasing short of the end
 * returns the handle.
 * @license GPL-3.0-only
 */

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronsRight } from "lucide-react";
import type { ConfirmHold } from "./use-confirm-hold";
import { cn } from "@/lib/utils";

/** Fraction of the track the handle must reach to confirm. */
const COMPLETE_AT = 0.92;
const HANDLE_PX = 48;

interface SlideToConfirmProps {
  /** Key / gamepad hold state (its pointer handlers are not used here). */
  hold: ConfirmHold;
  holdMs: number;
  label: string;
  hint: string;
  disabled: boolean;
  onComplete: () => void;
}

export function SlideToConfirm({
  hold,
  holdMs,
  label,
  hint,
  disabled,
  onComplete,
}: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; travel: number } | null>(null);
  const [fraction, setFraction] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const track = trackRef.current;
    if (!track) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      startX: e.clientX,
      travel: Math.max(1, track.clientWidth - HANDLE_PX),
    };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setFraction(Math.max(0, Math.min(1, (e.clientX - d.startX) / d.travel)));
  };

  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (fraction >= COMPLETE_AT) {
      setFraction(1);
      onComplete();
    } else {
      setFraction(0);
    }
  };

  // A key or gamepad hold drives the handle across the track over the hold.
  const shown = hold.holding ? 1 : fraction;
  const transition = dragging
    ? "none"
    : hold.holding
      ? `transform ${holdMs}ms linear`
      : "transform 200ms ease-out";

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        data-hold-control="true"
        aria-label={label}
        aria-describedby="skill-confirm-slide-hint"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        aria-disabled={disabled}
        className={cn(
          "@container relative h-12 w-full select-none overflow-hidden rounded-md border border-status-error/70 bg-bg-tertiary",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
          disabled && "opacity-50",
        )}
      >
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-wide text-status-error">
          {label}
        </span>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          className={cn(
            "absolute inset-y-0 left-0 flex touch-none items-center justify-center rounded-md bg-status-error text-on-media",
            disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
          )}
          style={{
            width: HANDLE_PX,
            transform: `translateX(calc(${shown} * (100cqw - ${HANDLE_PX}px)))`,
            transition,
          }}
          data-testid="slide-handle"
        >
          <ChevronsRight size={20} aria-hidden="true" />
        </div>
      </div>
      <span id="skill-confirm-slide-hint" className="text-[11px] text-text-tertiary">
        {hint}
      </span>
    </div>
  );
}
