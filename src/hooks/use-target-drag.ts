"use client";

/**
 * @module use-target-drag
 * @description Drag-to-designate on empty video. A primary-button press on
 * the video under the target layer (not on a target or a control), inside
 * the rendered video rect, becomes a selection once the pointer travels
 * 12 px. Release reports the rect in frame px when it covers at least 1 % of
 * the frame on both axes. Esc or a second pointer cancels.
 *
 * The layer itself is `pointer-events: none`, so the press is read on its
 * parent (the video container).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState, type RefObject } from "react";

import type { RenderedRect } from "@/lib/plugins/video-overlay-props";
import type { Point, ScreenRect } from "@/lib/vision/target-geometry";
import {
  dragAccepted,
  dragFrameBox,
  dragScreenRect,
  dragStarted,
} from "@/lib/vision/target-interaction";
import type { DetectionBox } from "@/stores/vision-detections-store";

export interface DragGeometry {
  rendered: RenderedRect;
  frameW: number;
  frameH: number;
}

const SKIP_TARGETS = "[data-target-interactive], button, a, input, select, textarea, [role='button']";

/** @returns the live selection rect (layer px) while dragging, else null. */
export function useTargetDrag(
  layerRef: RefObject<HTMLElement | null>,
  geometry: DragGeometry | null,
  onSelect: (box: DetectionBox) => void,
): ScreenRect | null {
  const [selection, setSelection] = useState<ScreenRect | null>(null);
  const geoRef = useRef(geometry);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    geoRef.current = geometry;
    selectRef.current = onSelect;
  });

  useEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    let start: Point | null = null;
    let dragging = false;

    const local = (e: PointerEvent): Point => {
      const r = layer.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const stop = () => {
      start = null;
      dragging = false;
      setSelection(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      const p = local(e);
      if (!dragging && !dragStarted(start, p)) return;
      dragging = true;
      setSelection(dragScreenRect(start, p));
    };
    const onUp = (e: PointerEvent) => {
      const from = start;
      const was = dragging;
      stop();
      const g = geoRef.current;
      if (!from || !was || !g) return;
      const box = dragFrameBox(dragScreenRect(from, local(e)), g.rendered, g.frameW, g.frameH);
      if (dragAccepted(box, g.frameW, g.frameH)) selectRef.current(box);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !start) return;
      e.stopImmediatePropagation();
      stop();
    };
    const onDown = (e: PointerEvent) => {
      if (start) {
        // A second pointer cancels the selection.
        stop();
        return;
      }
      const g = geoRef.current;
      if (e.button !== 0 || !g) return;
      const target = e.target as Element | null;
      if (target?.closest(SKIP_TARGETS)) return;
      const p = local(e);
      const r = g.rendered;
      if (p.x < r.left || p.y < r.top || p.x > r.left + r.width || p.y > r.top + r.height) return;
      start = p;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey, true);
    };

    host.addEventListener("pointerdown", onDown);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      stop();
    };
  }, [layerRef]);

  return selection;
}
