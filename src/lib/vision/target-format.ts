/**
 * @module vision/target-format
 * @description Text and geometry helpers for the HUD target glyphs: class
 * words, range and interval text, hold reasons, corner brackets, off-frame
 * arrow placement and the re-acquired toast. Used by the target resolver
 * (`target-state`) and the surfaces that draw its output.
 *
 * @license GPL-3.0-only
 */

import { HUD_COPY_EN, type HudCopy } from "./hud-copy";

/** Class word: uppercase, anything outside `[A-Z0-9 ]` → space, ≤ 12 chars. */
export function classWord(label: string): string {
  return label.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").slice(0, 12);
}

/** One decimal below 100 m, an integer at and above. */
export function formatRange(m: number): string {
  const rounded = Math.round(m * 10) / 10;
  return rounded >= 100 ? `${Math.round(m)} m` : `${rounded.toFixed(1)} m`;
}

/** `range − 2σ – range + 2σ m`. */
export function rangeInterval(rangeM: number, sigmaM: number): string {
  const lo = Math.max(0, rangeM - 2 * sigmaM);
  const hi = rangeM + 2 * sigmaM;
  return `${lo.toFixed(1)} – ${hi.toFixed(1)} m`;
}

/** `HOLD_NO_RANGE` → `NO RANGE`; null → null. */
export function holdReasonWord(reason: string | null): string | null {
  if (!reason) return null;
  return reason.replace(/^HOLD_/, "").replace(/_/g, " ").toUpperCase();
}

/** Bracket arm: `clamp(ratio·min(w, h), min, max)`. */
export function bracketArm(w: number, h: number, ratio = 0.22, min = 10, max = 28): number {
  const a = ratio * Math.min(w, h);
  return Math.round(Math.min(max, Math.max(min, a)) * 100) / 100;
}

/** Corner bracket path for a box (four L shapes on the outer edge). */
export function bracketPath(x: number, y: number, w: number, h: number, a: number): string {
  return [
    `M ${x},${y + a} V ${y} H ${x + a}`,
    `M ${x + w - a},${y} H ${x + w} V ${y + a}`,
    `M ${x + w},${y + h - a} V ${y + h} H ${x + w - a}`,
    `M ${x + a},${y + h} H ${x} V ${y + h - a}`,
  ].join(" ");
}

/** Wrap an angle into (−180, 180]. */
export function wrap180(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Off-frame arrow position: the ray from the rect centre at screen angle `rel`
 * (clockwise from up) meets the rect inset by `inset` px.
 */
export function offFrameArrow(
  relDeg: number,
  rect: { left: number; top: number; width: number; height: number },
  inset = 16,
): { x: number; y: number; edge: "top" | "right" | "bottom" | "left" } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rad = (relDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const halfW = rect.width / 2 - inset;
  const halfH = rect.height / 2 - inset;
  const tx = Math.abs(dx) < 1e-9 ? Infinity : halfW / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-9 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  const edge = ty <= tx ? (dy < 0 ? "top" : "bottom") : dx > 0 ? "right" : "left";
  return { x: Math.round(cx + dx * t), y: Math.round(cy + dy * t), edge };
}

/** The re-acquired toast copy. */
export function reacquiredToast(
  e: { trackId: number; similarity: number; gapS: number },
  copy: HudCopy = HUD_COPY_EN,
): string {
  return copy.reacquired(e.trackId, e.similarity.toFixed(2), e.gapS.toFixed(1));
}
