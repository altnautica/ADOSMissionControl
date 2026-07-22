"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
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

/**
 * A `role="menu"` claims the ARIA menu contract, so this component honours it:
 * the trigger advertises `aria-haspopup`/`aria-expanded`, opening moves focus
 * into the menu, Up/Down/Home/End walk the items on a roving tabindex, and
 * Escape or Tab closes and hands focus back to the trigger. Without that,
 * assistive tech switches to menu-interaction mode on open and every key it
 * promises the operator does nothing.
 */
export function DropdownMenu({ trigger, items, onSelect, align = "left" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const [focusIdx, setFocusIdx] = useState(-1);
  // Set when the menu is opened, consumed once its DOM exists: focus then moves
  // to the first usable item, per the menu pattern.
  const pendingFocus = useRef(false);
  // The menu portals to document.body with a fixed, viewport-derived slot so no
  // ancestor's overflow clip (a scrollable table wrapper, a panel) can cut it
  // off — the same machinery the Select popup uses.
  const { style, compute } = useAnchoredPosition(wrapRef, open, { align });

  const openMenu = useCallback(() => {
    compute();
    // The first usable item is chosen now, while the menu's DOM does not exist
    // yet; the focus effect below moves real focus once it does.
    const first = items.findIndex((item) => !item.divider && !item.disabled);
    setFocusIdx(first);
    pendingFocus.current = true;
    setOpen(true);
  }, [compute, items]);

  const restoreFocus = useCallback(() => {
    wrapRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  const closeMenu = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setFocusIdx(-1);
      if (returnFocus) restoreFocus();
    },
    [restoreFocus],
  );

  /** Indexes of the items focus can rove over, in menu order. */
  const focusOrder = useCallback(
    () => items.flatMap((item, i) => (item.divider || item.disabled ? [] : [i])),
    [items],
  );

  const focusItem = useCallback((index: number) => {
    setFocusIdx(index);
    itemRefs.current.get(index)?.focus();
  }, []);

  // Runs every render, but only the one following an open actually focuses:
  // the portal's buttons exist by then, and the guard keeps later re-renders
  // (an item enabling, a label changing) from yanking focus back to the top.
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    pendingFocus.current = false;
    itemRefs.current.get(focusIdx)?.focus();
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setFocusIdx(-1);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const order = focusOrder();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    }
    if (e.key === "Tab") {
      // Close and put focus back on the trigger without cancelling the key, so
      // the tab sequence continues from the trigger rather than from the end
      // of the document where the portal lives.
      closeMenu(true);
      return;
    }
    if (order.length === 0) return;
    const pos = order.indexOf(focusIdx);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(order[pos < 0 ? 0 : (pos + 1) % order.length]);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(order[pos <= 0 ? order.length - 1 : pos - 1]);
        break;
      case "Home":
        e.preventDefault();
        focusItem(order[0]);
        break;
      case "End":
        e.preventDefault();
        focusItem(order[order.length - 1]);
        break;
    }
  }

  // The trigger element itself advertises the popup so assistive tech announces
  // "menu button, collapsed/expanded" — the wrapper cannot carry these for it.
  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<HTMLAttributes<HTMLElement>>, {
        "aria-haspopup": "menu",
        "aria-expanded": open,
      })
    : trigger;

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      onKeyDown={(e) => {
        // With focus still on the trigger: the arrow keys open the menu (focus
        // then moves to the first item), Escape closes it.
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
          e.preventDefault();
          openMenu();
          return;
        }
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          closeMenu(true);
        }
      }}
    >
      <div onClick={() => (open ? closeMenu(false) : openMenu())}>{triggerNode}</div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            onKeyDown={onMenuKeyDown}
            className="min-w-[160px] overflow-y-auto border border-border-default bg-bg-secondary py-1 shadow-lg"
          >
            {items.map((item, index) =>
              item.divider ? (
                <div key={item.id} className="border-t border-border-default my-1" />
              ) : (
                <button
                  key={item.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(index, el);
                    else itemRefs.current.delete(index);
                  }}
                  role="menuitem"
                  tabIndex={index === focusIdx ? 0 : -1}
                  title={item.title}
                  disabled={item.disabled}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors focus:outline-none",
                    item.disabled
                      ? "text-text-tertiary opacity-50 cursor-not-allowed"
                      : item.danger
                        ? "text-status-error hover:bg-status-error/10 focus:bg-status-error/10 cursor-pointer"
                        : "text-text-primary hover:bg-bg-tertiary focus:bg-bg-tertiary cursor-pointer"
                  )}
                  onClick={() => {
                    if (item.disabled) return;
                    onSelect(item.id);
                    closeMenu(true);
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
