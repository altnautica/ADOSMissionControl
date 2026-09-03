"use client";

import { cn } from "@/lib/utils";

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ label, checked, onChange, disabled, className }: ToggleProps) {
  return (
    <label className={cn("flex items-center justify-between gap-2", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer", className)}>
      <span className="text-xs text-text-secondary">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        // The visible `<span>` is a sibling, not the button's content, so the
        // switch had no reliable accessible name — screen readers differ on
        // whether a wrapping <label> names a <button>. Name it explicitly.
        aria-label={label}
        disabled={disabled}
        onClick={() => { if (!disabled) onChange(!checked) }}
        className={cn(
          "relative w-8 h-4 border transition-colors focus-ring",
          disabled ? "opacity-50 cursor-not-allowed" : "",
          checked ? "bg-accent-primary border-accent-primary" : "bg-bg-tertiary border-border-default"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-2.5 h-2.5 transition-transform",
            // Thumb colour is per-state, not a fixed white: on `bg-bg-tertiary`
            // (light in the four light themes) a white thumb was invisible, so
            // the operator could not tell the switch was off.
            checked ? "bg-accent-foreground" : "bg-text-secondary",
            checked ? "left-[14px]" : "left-0.5"
          )}
        />
      </button>
    </label>
  );
}
