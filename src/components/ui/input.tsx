"use client";

import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  error?: string;
  unit?: string;
}

export function Input({ label, error, unit, className, id, ...props }: InputProps) {
  const inputId = id || (typeof label === "string" ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
  // The error text was rendered as a loose <span> with no association, so a
  // screen reader read the field as valid and never announced why a write was
  // rejected. `aria-invalid` + `aria-describedby` wire it up.
  const errorId = error && inputId ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            "w-full h-8 px-2 bg-bg-tertiary border text-sm font-mono text-text-primary placeholder:text-text-tertiary",
            "focus:outline-none focus:border-accent-primary transition-colors focus-ring",
            error ? "border-status-error" : "border-border-default",
            unit && "pr-8",
            className
          )}
          {...props}
        />
        {unit && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary font-mono">
            {unit}
          </span>
        )}
      </div>
      {error && (
        <span id={errorId} className="text-[10px] text-status-error">
          {error}
        </span>
      )}
    </div>
  );
}
