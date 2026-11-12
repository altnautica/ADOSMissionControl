"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface BadgeProps {
  variant?: "success" | "warning" | "serious" | "error" | "info" | "neutral";
  size?: "sm" | "md";
  children: ReactNode;
  className?: string;
}

/** Outline badge: a tinted hairline and coloured text on no fill, in sentence
 *  case, so a status reads without shouting over the content beside it. */
const variantStyles: Record<string, string> = {
  success: "border-status-success/40 text-status-success",
  warning: "border-status-warning/40 text-status-warning",
  serious: "border-status-serious/40 text-status-serious",
  error: "border-status-error/40 text-status-error",
  info: "border-accent-primary/40 text-accent-primary",
  neutral: "border-border-default text-text-secondary",
};

const sizeStyles: Record<string, string> = {
  sm: "h-5 px-1.5 text-[11px]",
  md: "h-6 px-2 text-xs",
};

export function Badge({ variant = "neutral", size = "sm", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border bg-transparent font-medium leading-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  );
}
