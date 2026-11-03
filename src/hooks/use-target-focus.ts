"use client";

/**
 * @module use-target-focus
 * @description Keyboard focus over drawn targets: `[` / `]` cycle a focus
 * ring across the focusable items left to right, `Enter` opens the menu for
 * the focused item, and `Esc` clears the focus before anything else handles
 * it (an open menu closes first through its own handler). Keys typed into a
 * text field are ignored. The focus key is owned by the caller, so the layout
 * can reveal the focused item's tag.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { cycleFocus } from "@/lib/vision/target-interaction";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.isContentEditable || el.closest("input, textarea, select, [contenteditable='true']") !== null;
}

export interface TargetFocusOptions {
  enabled: boolean;
  /** Focusable keys, left to right. */
  order: readonly string[];
  /** The focused key (null when none or no longer drawn). */
  focusKey: string | null;
  setFocusKey: (key: string | null) => void;
  /** A menu is open (Esc belongs to it). */
  menuOpen: boolean;
  onActivate: (key: string) => void;
}

export function useTargetFocus(o: TargetFocusOptions): void {
  const live = useRef(o);
  useEffect(() => {
    live.current = o;
  });

  useEffect(() => {
    if (!o.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const { order, focusKey, setFocusKey, menuOpen, onActivate } = live.current;
      if (e.key === "[" || e.key === "]") {
        if (order.length === 0) return;
        // While targets are drawn the bracket keys belong to target focus and
        // preempt a Skill Bar binding on the same key (as target hotkeys do),
        // so one press never also fires that skill.
        e.preventDefault();
        e.stopImmediatePropagation();
        const next = cycleFocus(order, focusKey, e.key === "]" ? 1 : -1);
        live.current = { ...live.current, focusKey: next };
        setFocusKey(next);
      } else if (e.key === "Enter" && focusKey) {
        e.preventDefault();
        onActivate(focusKey);
      } else if (e.key === "Escape" && focusKey && !menuOpen) {
        e.stopImmediatePropagation();
        live.current = { ...live.current, focusKey: null };
        setFocusKey(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [o.enabled]);
}
