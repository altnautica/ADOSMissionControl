"use client";

/**
 * @module ui/use-anchored-position
 * @description Viewport positioning for popups that render through a portal.
 *
 * The Select component established the pattern this hook packages: render the
 * popup into `document.body` with `position: fixed`, compute its slot from the
 * trigger's viewport rect, flip above the trigger when the space below cannot
 * hold it, and recompute on any scroll or resize while open. A popup rendered
 * in place instead inherits every ancestor's clipping — a wrapper that scrolls
 * on one axis becomes a scroll container on both (a non-`visible` overflow on
 * either axis computes the other to `auto`), and no z-index escapes a scroll
 * container's clip.
 *
 * Callers invoke `compute()` immediately before opening so the first paint is
 * already positioned; the hook only owns the reposition listeners.
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export interface AnchoredPositionOptions {
  /** Which trigger edge the popup's matching edge sticks to. */
  align?: "left" | "right";
  /** Gap between the trigger and the popup, in px. */
  gap?: number;
  /** Popup height cap; also the space needed below before flipping above. */
  maxHeight?: number;
  /** Estimated popup width, used only to keep a left-aligned popup on screen. */
  estimatedWidth?: number;
}

export interface AnchoredPosition {
  /** Spread onto the portaled popup. Includes the `maxHeight` cap, so give the
   * popup its own inner scroll (`overflow-y-auto`). */
  style: CSSProperties;
  /** Recompute from the anchor's current rect. Call right before opening. */
  compute: () => void;
}

export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  {
    align = "left",
    gap = 4,
    maxHeight = 280,
    estimatedWidth = 160,
  }: AnchoredPositionOptions = {},
): AnchoredPosition {
  const [pos, setPos] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flip: false,
  });

  const compute = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < maxHeight && rect.top > spaceBelow;
    let left = rect.left;
    if (left + estimatedWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - estimatedWidth - 8);
    }
    setPos({
      top: rect.bottom + gap,
      bottom: window.innerHeight - rect.top + gap,
      left,
      right: Math.max(8, window.innerWidth - rect.right),
      flip,
    });
  }, [anchorRef, estimatedWidth, gap, maxHeight]);

  useEffect(() => {
    if (!open) return;
    compute();
    const reposition = () => compute();
    window.addEventListener("scroll", reposition, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", reposition, { passive: true });
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, compute]);

  const style: CSSProperties = {
    position: "fixed",
    zIndex: 3000,
    maxHeight,
    ...(align === "right" ? { right: pos.right } : { left: pos.left }),
    ...(pos.flip ? { bottom: pos.bottom } : { top: pos.top }),
  };

  return { style, compute };
}
