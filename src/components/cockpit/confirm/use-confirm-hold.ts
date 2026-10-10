"use client";

/**
 * @module cockpit/confirm/use-confirm-hold
 * @description The press-and-hold engine behind every confirm tier. A hold is
 * satisfied by any of three sources held continuously for `holdMs`: the
 * pointer on the sheet's hold control, the Enter key, or the gamepad button
 * that opened the request (button 0 when a pointer or key opened it). Letting
 * go before the time is up cancels the hold; nothing partial is kept.
 *
 * Completion runs off one timer armed when the hold starts, so the outcome
 * never depends on animation frames; the progress fill is a CSS transition
 * driven by `holding`.
 * @license GPL-3.0-only
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useInputStore } from "@/stores/input-store";

/** The gamepad button that confirms when no button opened the request. */
const DEFAULT_CONFIRM_BUTTON = 0;

export interface ConfirmHoldOptions {
  holdMs: number;
  /** False keeps every source inert (checklist override not given yet). */
  enabled: boolean;
  /** The gamepad button that opened the request, if any. */
  gamepadButton?: number;
  onComplete: () => void;
}

export interface ConfirmHold {
  /** True while a source is held and the hold is running. */
  holding: boolean;
  /** Pointer handlers for the on-screen hold control. */
  pointerHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
  };
}

/** True when a key event belongs to a control that owns Enter itself. */
function ownsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.dataset.holdControl === "true") return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "BUTTON" ||
    target.isContentEditable
  );
}

export function useConfirmHold({
  holdMs,
  enabled,
  gamepadButton,
  onComplete,
}: ConfirmHoldOptions): ConfirmHold {
  const [pointerDown, setPointerDown] = useState(false);
  const [keyDown, setKeyDown] = useState(false);
  const button = gamepadButton ?? DEFAULT_CONFIRM_BUTTON;
  const padDown = useInputStore((s) => s.buttons[button] === true);

  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  // Enter is a hold source while the sheet is open.
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || ownsEnter(e.target)) return;
      e.preventDefault();
      setKeyDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Enter") setKeyDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [enabled]);

  const holding = enabled && (pointerDown || keyDown || padDown);

  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => completeRef.current(), holdMs);
    return () => clearTimeout(timer);
  }, [holding, holdMs]);

  const release = () => setPointerDown(false);

  return {
    holding,
    pointerHandlers: {
      onPointerDown: (e) => {
        if (!enabled) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setPointerDown(true);
      },
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
    },
  };
}
