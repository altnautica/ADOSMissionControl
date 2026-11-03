/**
 * @module vision/target-geometry
 * @description Screen geometry for the HUD target marks: frame-to-screen
 * mapping (letterbox or cover), hit areas, the centre reticle, feet tick,
 * search ring and sweep, the off-frame arrow, and the coasting ghost-path
 * samples. Pure; tag placement and the per-item layout live in
 * `target-layout`.
 *
 * @license GPL-3.0-only
 */

import type { RenderedRect } from "@/lib/plugins/video-overlay-props";

import type { FrameRect } from "./target-state";

export const HIT_MIN = 44;
export const RETICLE_GAP = 6;
export const RETICLE_ARM = 18;
export const FEET_TICK = 10;
export const ARROW_LEN = 14;
export const ARROW_INSET = 16;
export const SEARCH_RING_MIN = 24;
export const SEARCH_RING_RATIO = 0.6;
export const GHOST_WINDOW_MS = 1000;
export const GHOST_MAX = 30;
export const FOCUS_OFFSET = 3;

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A followed-box bottom-centre sample in frame px. */
export interface GhostSample {
  t: number;
  x: number;
  y: number;
}

/** `object-cover` placement of a frame inside a wrapper. */
export function coverRect(wrapW: number, wrapH: number, frameW: number, frameH: number): RenderedRect {
  if (frameW <= 0 || frameH <= 0 || wrapW <= 0 || wrapH <= 0) {
    return { left: 0, top: 0, width: wrapW, height: wrapH };
  }
  const scale = Math.max(wrapW / frameW, wrapH / frameH);
  const width = frameW * scale;
  const height = frameH * scale;
  return { left: (wrapW - width) / 2, top: (wrapH - height) / 2, width, height };
}

export function frameToScreen(r: FrameRect, frameW: number, frameH: number, rr: RenderedRect): ScreenRect {
  const sx = frameW > 0 ? rr.width / frameW : 0;
  const sy = frameH > 0 ? rr.height / frameH : 0;
  return { x: rr.left + r.x * sx, y: rr.top + r.y * sy, w: r.w * sx, h: r.h * sy };
}

export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Hit area: the box inflated about its centre to at least `min` square. */
export function inflateHit(box: ScreenRect, min = HIT_MIN): ScreenRect {
  const w = Math.max(box.w, min);
  const h = Math.max(box.h, min);
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}

/** Centre reticle; null when the box is smaller than `2·(gap+arm)`. */
export function reticlePath(box: ScreenRect, gap = RETICLE_GAP, arm = RETICLE_ARM): string | null {
  const span = 2 * (gap + arm);
  if (box.w < span || box.h < span) return null;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return [
    `M ${cx},${cy - gap} V ${cy - gap - arm}`,
    `M ${cx + gap},${cy} H ${cx + gap + arm}`,
    `M ${cx},${cy + gap} V ${cy + gap + arm}`,
    `M ${cx - gap},${cy} H ${cx - gap - arm}`,
  ].join(" ");
}

export function feetTickPath(box: ScreenRect): string {
  const cx = box.x + box.w / 2;
  const y = box.y + box.h;
  return `M ${cx - FEET_TICK / 2},${y} H ${cx + FEET_TICK / 2}`;
}

/** Search ring at the predicted feet point, radius `max(24, 0.6·h)`. */
export function searchRing(box: ScreenRect): { cx: number; cy: number; r: number } {
  return {
    cx: box.x + box.w / 2,
    cy: box.y + box.h,
    r: Math.max(SEARCH_RING_MIN, SEARCH_RING_RATIO * box.h),
  };
}

/** The 90° sweep arc, from 12 o'clock clockwise to 3 o'clock. */
export function sweepArcPath(cx: number, cy: number, r: number): string {
  return `M ${cx},${cy - r} A ${r},${r} 0 0 1 ${cx + r},${cy}`;
}

/** Unit vector for a screen angle measured clockwise from up. */
export function screenDirection(relDeg: number): Point {
  const rad = (relDeg * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** Isosceles triangle centred on `(x, y)`, tip pointing along `relDeg`
 * (screen angle, clockwise from up). */
export function arrowPath(x: number, y: number, relDeg: number, len = ARROW_LEN): string {
  const d = screenDirection(relDeg);
  const n = { x: -d.y, y: d.x };
  const half = len / 2;
  const wing = len * 0.4;
  const tip = { x: x + d.x * half, y: y + d.y * half };
  const base = { x: x - d.x * half, y: y - d.y * half };
  const f = (v: number) => Math.round(v * 100) / 100;
  return (
    `M ${f(tip.x)},${f(tip.y)} ` +
    `L ${f(base.x + n.x * wing)},${f(base.y + n.y * wing)} ` +
    `L ${f(base.x - n.x * wing)},${f(base.y - n.y * wing)} Z`
  );
}

/** Append a followed-box sample, keeping the last 1 s and at most 30. */
export function pushGhostSample(samples: readonly GhostSample[], s: GhostSample): GhostSample[] {
  const next = samples.filter((p) => p.t >= s.t - GHOST_WINDOW_MS && p.t <= s.t);
  next.push(s);
  return next.length > GHOST_MAX ? next.slice(next.length - GHOST_MAX) : next;
}
