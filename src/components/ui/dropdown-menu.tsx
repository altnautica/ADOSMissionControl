"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useAnchoredPosition } from "./use-anchored-position";

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu portals to document.body with a fixed, viewport-derived slot so no
  // ancestor's overflow clip (a scrollable table wrapper, a panel) can cut it
  // off — the same machinery the Select popup uses.
  const { style, compute } = useAnchoredPosition(wrapRef, open, { align });

  const openMenu = useCallback(() => {
    compute();
    setOpen(true);
  }, [compute]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      // Escape closes from anywhere inside and returns focus to the trigger, so
      // a keyboard operator is not dropped at the top of the document. The
      // portaled menu is still a React child of this wrapper, so its key events
      // bubble here.
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
        wrapRef.current?.querySelector<HTMLElement>("button")?.focus();
      }}
    >
      <div onClick={() => (open ? setOpen(false) : openMenu())}>{trigger}</div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className="min-w-[160px] overflow-y-auto border border-border-default bg-bg-secondary py-1 shadow-lg"
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
          </div>,
          document.body,
        )}
    </div>
  );
}
