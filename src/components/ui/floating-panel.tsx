/**
 * @module FloatingPanel
 * @description Shared presentational wrapper for map/globe floating overlays.
 * Encapsulates the glass-card recipe (blurred translucent surface + border +
 * rounded + shadow) and the shared z-index scale that every Plan/Simulate
 * overlay used to hand-roll. Position via `corner` (standard 1rem inset) or
 * pass explicit positioning classes through `className`.
 * @license GPL-3.0-only
 */

"use client";

import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MAP_OVERLAY_Z, type MapOverlayLayer } from "@/lib/map-overlay-z";

type Corner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center";

const CORNER_CLASS: Record<Corner, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "top-center": "top-4 left-1/2 -translate-x-1/2",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
};

interface FloatingPanelProps {
  children: ReactNode;
  /** Anchor corner (standard 1rem inset). Omit and use `className` for custom insets. */
  corner?: Corner;
  /** z-index layer token (default "panel"). */
  layer?: MapOverlayLayer;
  /** Apply the default `p-2` padding (default true). */
  padded?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(
  function FloatingPanel(
    { children, corner, layer = "panel", padded = true, className, style },
    ref,
  ) {
    return (
      <div
        ref={ref}
        style={{ zIndex: MAP_OVERLAY_Z[layer], ...style }}
        className={cn(
          "absolute rounded-xl border border-border-default bg-bg-primary/80 backdrop-blur-md shadow-lg",
          corner && CORNER_CLASS[corner],
          padded && "p-2",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
