/**
 * @module vision/target-interaction
 * @description Pointer and keyboard geometry for the HUD target layer:
 * drag-to-designate rects (screen → frame px, minimum size), and the
 * left-to-right focus cycle over drawn targets. Pure.
 *
 * @license GPL-3.0-only
 */

import type { RenderedRect } from "@/lib/plugins/video-overlay-props";
import type { DetectionBox } from "@/stores/vision-detections-store";

import type { Point, ScreenRect } from "./target-geometry";
import type { GlyphLayout } from "./target-layout";

export const DRAG_MIN_PX = 12;
export const DRAG_MIN_FRAC = 0.01;
/** A single click waits this long so a double click never also designates. */
export const DOUBLE_CLICK_MS = 250;

/** Screen-space selection rect from two pointer points. */
export function dragScreenRect(a: Point, b: Point): ScreenRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** A press becomes a drag once the pointer travels 12 px. */
export function dragStarted(a: Point, b: Point): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_MIN_PX;
}

/** A screen selection rect in frame px, clipped to the frame. */
export function dragFrameBox(
  r: ScreenRect,
  rr: RenderedRect,
  frameW: number,
  frameH: number,
): DetectionBox {
  const sx = rr.width > 0 ? frameW / rr.width : 0;
  const sy = rr.height > 0 ? frameH / rr.height : 0;
  const x0 = Math.min(frameW, Math.max(0, (r.x - rr.left) * sx));
  const y0 = Math.min(frameH, Math.max(0, (r.y - rr.top) * sy));
  const x1 = Math.min(frameW, Math.max(0, (r.x + r.w - rr.left) * sx));
  const y1 = Math.min(frameH, Math.max(0, (r.y + r.h - rr.top) * sy));
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    width: Math.round(x1 - x0),
    height: Math.round(y1 - y0),
  };
}

/** A drag-designate rect under 1 % of the frame width or height is ignored. */
export function dragAccepted(box: DetectionBox, frameW: number, frameH: number): boolean {
  return box.width >= DRAG_MIN_FRAC * frameW && box.height >= DRAG_MIN_FRAC * frameH;
}

/** Keys of focusable items (detection-backed), left to right. */
export function focusOrder(layouts: readonly GlyphLayout[]): string[] {
  return layouts
    .filter((l): l is GlyphLayout & { box: ScreenRect } => l.hit !== null && l.box !== null)
    .sort((a, b) => a.box.x - b.box.x)
    .map((l) => l.key);
}

/** Next focus key cycling `dir` through `order`; null when empty. */
export function cycleFocus(order: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = current === null ? -1 : order.indexOf(current);
  if (i === -1) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}
