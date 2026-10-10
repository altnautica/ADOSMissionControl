/**
 * @module Tooltip
 * @description Portaled tooltip primitive used across the GCS. The
 * overlay mounts on `document.body` (not the trigger's parent) so it
 * escapes ancestor `overflow-hidden`, `transform`, and `contain`
 * properties from modals and scroll containers. Position is computed
 * from the trigger's bounding box in viewport coordinates with
 * viewport-aware clamping and bottom-overflow flip.
 *
 * The default placement is `bottom` (overlay extends below the trigger
 * with its right edge clamped inside the viewport so it never spills
 * off the right when the trigger sits at the far right of a modal).
 * The previous in-flow positioning caused mid-character clipping at
 * the modal's right edge.
 *
 * @license GPL-3.0-only
 */

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface TooltipProps {
  // string keeps the original one-line tooltip behavior; ReactNode
  // enables richer multi-line content (e.g. metric explanations in the
  // video latency breakdown popover).
  content: string | ReactNode;
  children: ReactNode;
  // Preferred placement before viewport clamping. `bottom` keeps the
  // overlay's right edge aligned with the trigger's right edge so the
  // body extends left into the row, not right off the screen.
  position?: "top" | "bottom" | "left" | "right";
  // Default content is single-line. Set multiline when the content
  // needs to wrap, which also widens the tooltip.
  multiline?: boolean;
  className?: string;
  // Class on the trigger wrapper span. Defaults to "relative inline-flex"
  // (the historical shrink-to-content trigger). Pass "relative block w-full"
  // (or a flex variant) to wrap a full-width block-level child — e.g. a whole
  // sidebar row — so the trigger fills its column instead of collapsing and the
  // overlay anchors off the child's real bounds.
  triggerClassName?: string;
}

interface OverlayPosition {
  top: number;
  left: number;
  /** True when the overlay was flipped above the trigger because there
   * was no room below. The arrow + visual padding can read this if
   * needed (the current design has no arrow, so it's metadata only). */
  flipped: boolean;
}

const VIEWPORT_MARGIN = 8;
const CLOSE_DELAY_MS = 150;
const OVERLAY_MAX_WIDTH = 24 * 16; // 24rem at 16px root font
const OVERLAY_FALLBACK_HEIGHT = 64;

export function Tooltip({
  content,
  children,
  position = "bottom",
  multiline = false,
  className,
  triggerClassName = "relative inline-flex",
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<OverlayPosition | null>(null);

  const hasContent =
    content !== null &&
    content !== undefined &&
    !(typeof content === "string" && content.length === 0);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setShow(false);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  const openNow = useCallback(() => {
    cancelClose();
    setShow(true);
  }, [cancelClose]);

  // Compute the overlay's viewport position from the trigger's bounds.
  // Runs on `show` toggle and on every resize / scroll while open.
  const recompute = useCallback(() => {
    if (!show) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();

    // Overlay size — read live when possible, fall back to the upper
    // bound when the overlay has not painted yet (first frame).
    const overlay = overlayRef.current;
    const overlayWidth = Math.min(
      overlay?.offsetWidth ?? OVERLAY_MAX_WIDTH,
      OVERLAY_MAX_WIDTH,
    );
    const overlayHeight = overlay?.offsetHeight ?? OVERLAY_FALLBACK_HEIGHT;

    if (typeof window === "undefined") {
      setPos({ top: 0, left: 0, flipped: false });
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default placement: bottom-end. The overlay's right edge sits at
    // the trigger's right edge and the body extends left.
    let top = rect.bottom + 6;
    let left = rect.right - overlayWidth;
    let flipped = false;

    if (position === "top") {
      top = rect.top - overlayHeight - 6;
    } else if (position === "left") {
      top = rect.top + rect.height / 2 - overlayHeight / 2;
      left = rect.left - overlayWidth - 6;
    } else if (position === "right") {
      top = rect.top + rect.height / 2 - overlayHeight / 2;
      left = rect.right + 6;
    }

    // Vertical viewport-aware flip: if the overlay would spill out the
    // bottom, place it above the trigger instead. Only relevant for
    // `bottom` placement (where the original frame put it below).
    if (
      (position === "bottom" || position === "top") &&
      top + overlayHeight > vh - VIEWPORT_MARGIN
    ) {
      top = rect.top - overlayHeight - 6;
      flipped = position === "bottom";
    }
    if (top < VIEWPORT_MARGIN) {
      top = VIEWPORT_MARGIN;
    }

    // Horizontal clamping. Default placement aligns the overlay's
    // right edge with the trigger; clamp inside an 8px viewport margin
    // on both edges so a wide overlay never spills.
    if (left + overlayWidth > vw - VIEWPORT_MARGIN) {
      left = vw - VIEWPORT_MARGIN - overlayWidth;
    }
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
    }

    setPos({ top, left, flipped });
  }, [show, position]);

  // First placement computation runs after the overlay paints so the
  // measurement reflects the real overlay size. Subsequent updates
  // come from resize / scroll listeners.
  useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    recompute();
    // A follow-up rAF re-measures after layout in case the overlay
    // resized when the content swapped in (font metrics can shift
    // between the fallback size and the real size on first paint).
    const id =
      typeof window !== "undefined"
        ? window.requestAnimationFrame(recompute)
        : null;
    return () => {
      if (id !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(id);
      }
    };
  }, [show, recompute]);

  useEffect(() => {
    if (!show || typeof window === "undefined") return;
    let raf: number | null = null;
    const onResizeOrScroll = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        recompute();
      });
    };
    window.addEventListener("resize", onResizeOrScroll, { passive: true });
    window.addEventListener("scroll", onResizeOrScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      if (raf !== null) {
        window.cancelAnimationFrame(raf);
      }
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, { capture: true });
    };
  }, [show, recompute]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Esc closes the tooltip when the trigger or overlay holds focus.
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShow(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [show]);

  if (!hasContent) {
    return <>{children}</>;
  }

  const overlay =
    show && pos !== null ? (
      <div
        ref={overlayRef}
        id={tooltipId}
        role="tooltip"
        style={{ top: pos.top, left: pos.left, position: "fixed" }}
        className={cn(
          "z-[2000] min-w-[16rem] max-w-[24rem] rounded-md border border-border-default bg-bg-tertiary px-4 py-3 text-sm leading-relaxed text-text-primary shadow-xl",
          multiline ? "whitespace-normal break-words" : "whitespace-nowrap",
          className,
        )}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {content}
      </div>
    ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={triggerClassName}
        aria-describedby={show ? tooltipId : undefined}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
      >
        {children}
      </span>
      {overlay !== null && typeof document !== "undefined"
        ? createPortal(overlay, document.body)
        : null}
    </>
  );
}
