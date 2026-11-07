"use client";

/**
 * A press-and-hold control: it fires once the pointer (or Enter/Space) has
 * been held for `holdMs`, and shows the fill while held. Releasing early
 * cancels. With `holdMs` 0 it fires on click.
 *
 * @module cockpit/v2/HoldButton
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

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

  const stop = useCallback(() => {
    started.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);

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
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      data-testid={rest["data-testid"]}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") stop();
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
  );
}
