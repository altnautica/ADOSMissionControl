"use client";

/**
 * A press-and-hold control: it fires once the pointer (or Enter/Space) has
 * been held for `holdMs`, and shows the fill while held. Releasing early
 * cancels and shows the keep-holding hint (`hold.keep_holding`) next to the
 * control for {@link KEEP_HOLDING_MS}. With `holdMs` 0 it fires on click.
 *
 * @module cockpit/v2/HoldButton
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { specString } from "@/lib/cockpit/spec-strings";
import { cn } from "@/lib/utils";

/** How long the keep-holding hint stays up after an early release. */
export const KEEP_HOLDING_MS = 1500;

/** The keep-holding text for a hold of `holdMs`: "Keep holding · 1.5 s". */
export function keepHoldingText(holdMs: number): string {
  return specString("hold.keep_holding", { s: Number((holdMs / 1000).toFixed(1)) });
}

/** The keep-holding hint's state: `early()` (a hold let go before it
 *  completed) shows it for {@link KEEP_HOLDING_MS}, a later early release
 *  restarts that time. */
export function useKeepHoldingHint(): { shown: boolean; early: () => void } {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  const early = useCallback(() => {
    clearTimeout(timer.current ?? undefined);
    setShown(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(false);
    }, KEEP_HOLDING_MS);
  }, []);
  return { shown, early };
}

interface HoldButtonProps {
  holdMs: number;
  onFire: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Accent for the hold fill. */
  fillColor?: string;
  children: ReactNode;
  "data-testid"?: string;
}

export function HoldButton({
  holdMs,
  onFire,
  disabled,
  title,
  className,
  fillColor = "rgba(255,255,255,0.25)",
  children,
  ...rest
}: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const started = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { shown: hintShown, early } = useKeepHoldingHint();
  // Where the hint sits: under the control, measured when it is let go.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const stop = useCallback(() => {
    started.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);

  /** Let go: a hold still running ended early, so say to keep holding. */
  const release = useCallback(() => {
    if (started.current !== null) {
      const r = button.current?.getBoundingClientRect();
      setAnchor(r ? { x: r.left + r.width / 2, y: r.bottom } : null);
      early();
    }
    stop();
  }, [early, stop]);

  const start = useCallback(() => {
    if (disabled) return;
    if (holdMs <= 0) {
      onFire();
      return;
    }
    started.current = performance.now();
    const step = () => {
      if (started.current === null) return;
      const p = Math.min(1, (performance.now() - started.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        stop();
        onFire();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [disabled, holdMs, onFire, stop]);

  return (
    <>
      <button
        ref={button}
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        data-testid={rest["data-testid"]}
        onPointerDown={start}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === "Enter" || e.key === " ") release();
        }}
        className={cn(
          "relative overflow-hidden disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ width: `${progress * 100}%`, background: fillColor }}
        />
        <span className="relative">{children}</span>
      </button>
      {hintShown &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="status"
            data-testid="keep-holding-hint"
            className="glass-pill pointer-events-none fixed z-[200] -translate-x-1/2 whitespace-nowrap px-3 py-1 text-xs font-semibold text-text-primary"
            style={{ left: anchor?.x ?? 0, top: (anchor?.y ?? 0) + 4 }}
          >
            {keepHoldingText(holdMs)}
          </span>,
          document.body,
        )}
    </>
  );
}
