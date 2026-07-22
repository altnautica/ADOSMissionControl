"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
  /** Hover/focus text — used to say why a disabled item cannot run. */
  title?: string;
}

interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownItem[];
  onSelect: (id: string) => void;
  align?: "left" | "right";
}

export function DropdownMenu({ trigger, items, onSelect, align = "left" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      // Escape closes from anywhere inside and returns focus to the trigger, so
      // a keyboard operator is not dropped at the top of the document.
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLElement>("button")?.focus();
      }}
    >
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full mt-1 z-[2000] min-w-[160px] bg-bg-secondary border border-border-default py-1",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((item) =>
            item.divider ? (
              <div key={item.id} className="border-t border-border-default my-1" />
            ) : (
              <button
                key={item.id}
                role="menuitem"
                title={item.title}
                disabled={item.disabled}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors",
                  item.disabled
                    ? "text-text-tertiary opacity-50 cursor-not-allowed"
                    : item.danger
                      ? "text-status-error hover:bg-status-error/10 cursor-pointer"
                      : "text-text-primary hover:bg-bg-tertiary cursor-pointer"
                )}
                onClick={() => {
                  if (item.disabled) return;
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
