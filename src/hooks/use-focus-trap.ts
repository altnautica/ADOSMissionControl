"use client";

/**
 * Keep Tab inside a full-screen dialog that is not built on `Modal` (the
 * onboarding wizard and the disclaimer gate): Tab past the last reachable
 * control returns to the first, Shift+Tab before the first goes to the last,
 * and focus that has escaped is pulled back in. Controls inside an `inert` or
 * `hidden` subtree are skipped, the same rule `Modal` applies.
 *
 * @license GPL-3.0-only
 */

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.closest("[hidden], [inert], fieldset[disabled]")) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export function useFocusTrap(rootRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.key !== "Tab" || !root) return;
      const focusable = focusableIn(root);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inList = current != null && focusable.includes(current);
      if (e.shiftKey && (!inList || current === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inList || current === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [rootRef, active]);
}
