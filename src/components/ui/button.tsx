"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ReactNode, ButtonHTMLAttributes, Ref } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  /** Forwarded to the underlying element, so a dialog can pin initial focus
   * on a specific button (e.g. Cancel in a destructive confirmation). */
  ref?: Ref<HTMLButtonElement>;
}

const variantStyles: Record<string, string> = {
  // `text-accent-foreground`, not `text-white`: white failed WCAG AA against 18
  // of the 22 accent palettes (worst is nvg at 1.37:1, where white also breaks
  // night-vision discipline). The token resolves per theme in globals.css.
  primary: "bg-accent-primary text-accent-foreground hover:bg-accent-primary-hover",
  secondary: "bg-bg-tertiary text-text-primary border border-border-default hover:border-border-strong",
  ghost: "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
  danger: "bg-status-error/20 text-status-error border border-status-error/30 hover:bg-status-error/30",
};

const sizeStyles: Record<string, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-xs gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  className,
  // A `<button>` inside a `<form>` defaults to `type="submit"`, so every
  // Button placed in a form submitted it. Default to "button" and let a caller
  // opt into submit explicitly.
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors cursor-pointer",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-ring",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
