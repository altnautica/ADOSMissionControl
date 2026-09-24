"use client";

import { cn } from "@/lib/utils";
import type { StatusLevel } from "@/lib/status-level";

/**
 * The unified node/health status vocabulary, shared with `Badge`. Colour is
 * never the only channel: `shape` distinguishes filled vs hollow and every dot
 * carries an accessible label (the status word by default, override with
 * `label`) so it survives colour-blindness and the ~8px mini rail.
 */

interface StatusDotProps {
  status: StatusLevel;
  /** "dot" = filled (default); "ring" = hollow, for unknown / standby. */
  shape?: "dot" | "ring";
  /** Subtle attention pulse (respects prefers-reduced-motion via globals.css). */
  pulse?: boolean;
  /** Accessible label + tooltip; defaults to the status word. The non-colour channel. */
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const fillColor: Record<StatusLevel, string> = {
  good: "bg-status-success",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-error",
  idle: "bg-accent-primary",
  offline: "bg-text-tertiary",
};

const ringColor: Record<StatusLevel, string> = {
  good: "border-status-success",
  warning: "border-status-warning",
  serious: "border-status-serious",
  critical: "border-status-error",
  idle: "border-accent-primary",
  offline: "border-text-tertiary",
};

const sizeClass: Record<NonNullable<StatusDotProps["size"]>, string> = {
  xs: "w-1.5 h-1.5",
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
};

export function StatusDot({
  status,
  shape = "dot",
  pulse = false,
  label,
  size = "sm",
  className,
}: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={label ?? status}
      title={label ?? status}
      className={cn(
        "inline-block flex-shrink-0 rounded-full",
        sizeClass[size],
        shape === "ring"
          ? cn("border bg-transparent", ringColor[status])
          : fillColor[status],
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}
