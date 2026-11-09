/**
 * @module cockpit/layers/draw-targets
 * @description The `targets` layer drawn into the layer stack's canvas: the
 * HUD target glyphs (brackets or hairline, reticle, feet tick, search ring and
 * sweep, off-frame arrow, ghost path, keyboard focus ring and tag plates), the
 * composited cockpit marks (plugin and built-in reticles, points, polylines,
 * labels) and the designated target's lead reticle. These replace the SVG
 * glyph tree the cockpit drew before; the shapes, widths, dashes and fades
 * match the `.tgt-layer` rules, read from the same HUD tokens.
 *
 * Every line is painted twice: the outline colour at stroke + 2·outline, then
 * the state colour at stroke. Path strings from the layout are turned into
 * `Path2D` once per layout and cached on the layout object.
 *
 * @license GPL-3.0-only
 */

import type { CockpitMark, MarkFrame } from "@/lib/cockpit/marks";
import { FOCUS_OFFSET, type ScreenRect } from "@/lib/vision/target-geometry";
import type { GlyphLayout, PlacedTag } from "@/lib/vision/target-layout";
import { LOST_FADE_MS } from "@/lib/vision/target-state";
import { drawMarks } from "./draw-marks";

/** HUD token values the target layer paints with, resolved from CSS once per
 * theme or size change (never per frame). */
export interface TargetStyle {
  ink: string;
  primary: string;
  track: string;
  coast: string;
  crit: string;
  warn: string;
  muted: string;
  gt: string;
  lead: string;
  glass: string;
  outlineColor: string;
  stroke: number;
  outline: number;
  tagFont: string;
  tagWeight: string;
  tagPad: number;
}

const FALLBACK: TargetStyle = {
  ink: "#FFFFFF",
  primary: "#5B9AFF",
  track: "#22D3EE",
  coast: "#F59E0B",
  crit: "#EF4444",
  warn: "#F59E0B",
  muted: "#9CA3AF",
  gt: "#A3E635",
  lead: "#FDE047",
  glass: "rgba(0,0,0,0.55)",
  outlineColor: "rgba(0,0,0,0.6)",
  stroke: 2.5,
  outline: 1,
  tagFont: "'JetBrains Mono', monospace",
  tagWeight: "600",
  tagPad: 6,
};

/** Read the HUD tokens in scope at `el`. */
export function resolveTargetStyle(el: Element): TargetStyle {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const px = (name: string, fb: number) => {
    const n = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(n) ? n : fb;
  };
  return {
    ink: v("--hud-ink", FALLBACK.ink),
    primary: v("--hud-primary", FALLBACK.primary),
    track: v("--hud-track", FALLBACK.track),
    coast: v("--hud-coast", FALLBACK.coast),
    crit: v("--hud-crit", FALLBACK.crit),
    warn: v("--hud-warn", FALLBACK.warn),
    muted: v("--hud-muted", FALLBACK.muted),
    gt: v("--hud-gt", FALLBACK.gt),
    lead: v("--hud-lead", FALLBACK.lead),
    glass: v("--hud-glass", FALLBACK.glass),
    outlineColor: v("--hud-target-outline-color", FALLBACK.outlineColor),
    stroke: px("--hud-target-stroke", FALLBACK.stroke),
    outline: px("--hud-target-outline", FALLBACK.outline),
    tagFont: v("--hud-target-tag-font", FALLBACK.tagFont),
    tagWeight: v("--hud-target-tag-weight", FALLBACK.tagWeight),
    tagPad: px("--hud-target-tag-pad", FALLBACK.tagPad),
  };
}

function kindColor(kind: string, s: TargetStyle): string {
  switch (kind) {
    case "TRACKED":
      return s.primary;
    case "LOCKED":
    case "ACQUIRING":
    case "FOLLOWING":
    case "HOLDING":
      return s.track;
    case "COASTING":
    case "SEARCHING":
    case "SEARCHING_OFFFRAME":
      return s.coast;
    case "LOST":
      return s.crit;
    case "GT":
      return s.gt;
    default:
      return s.ink;
  }
}

function toneColor(tone: PlacedTag["tone"], s: TargetStyle): string {
  switch (tone) {
    case "primary":
      return s.primary;
    case "track":
      return s.track;
    case "coast":
      return s.coast;
    case "crit":
      return s.crit;
    case "warn":
      return s.warn;
    case "muted":
      return s.muted;
    case "gt":
      return s.gt;
    default:
      return s.ink;
  }
}

/** The target layout the draw loop paints, published by the React target
 * controller at detection rate. `at` is when it was laid out. */
export interface TargetScene {
  layouts: readonly GlyphLayout[];
  at: number;
  focusKey: string | null;
  reducedMotion: boolean;
  /** Composited cockpit marks and the frame they map from. */
  marks: readonly CockpitMark[];
  markFrame: MarkFrame | null;
  /** Browser clock (ms) the shown detection batch arrived, or null when no
   * batch was received. The layer dims and hides on its age like every
   * other layer. */
  batchAt: number | null;
}

const RE_SNAP_MS = 320;
const SWEEP_PERIOD_MS = 1200;
const NO_DASH: number[] = [];
const DASH_COAST = [4, 3];
const DASH_GT = [1.5, 3];
const DASH_FOCUS = [4, 3];

const pathCache = new WeakMap<GlyphLayout, Record<string, Path2D>>();

function paths(l: GlyphLayout): Record<string, Path2D> {
  let p = pathCache.get(l);
  if (!p) {
    p = {};
    if (l.brackets) p.brackets = new Path2D(l.brackets);
    if (l.reticle) p.reticle = new Path2D(l.reticle);
    if (l.feet) p.feet = new Path2D(l.feet);
    if (l.arrow) p.arrow = new Path2D(l.arrow.path);
    pathCache.set(l, p);
  }
  return p;
}

function outlined(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  width: number,
  s: TargetStyle,
): void {
  ctx.strokeStyle = s.outlineColor;
  ctx.lineWidth = width + 2 * s.outline;
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

function outlinedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  width: number,
  s: TargetStyle,
): void {
  ctx.strokeStyle = s.outlineColor;
  ctx.lineWidth = width + 2 * s.outline;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
}

function drawTag(ctx: CanvasRenderingContext2D, tag: PlacedTag, fontPx: number, s: TargetStyle): void {
  ctx.fillStyle = s.glass;
  ctx.beginPath();
  ctx.roundRect(tag.x, tag.y, tag.w, tag.h, 4);
  ctx.fill();
  ctx.font = tagFont(s, fontPx);
  ctx.fillStyle = toneColor(tag.tone, s);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(tag.text, tag.x + s.tagPad, tag.y + tag.h / 2);
}

/** CSS font strings per style and size, built once per value. */
const fontCache = new Map<string, Map<number, string>>();
function tagFont(s: TargetStyle, px: number): string {
  const family = `${s.tagWeight}|${s.tagFont}`;
  let bySize = fontCache.get(family);
  if (!bySize) {
    bySize = new Map();
    fontCache.set(family, bySize);
  }
  let f = bySize.get(px);
  if (f === undefined) {
    f = `${s.tagWeight} ${px}px ${s.tagFont}`;
    bySize.set(px, f);
  }
  return f;
}

/** ~63 % of the gap to a tracked box's new place closes in this window. */
const SMOOTH_TIME_CONSTANT_MS = 120;
/** Below this gap (px) an eased box snaps to its laid-out place. */
const CONVERGE_EPS_PX = 0.5;
/** The displayed (eased) screen box per tracked glyph key. */
interface EasedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  live: boolean;
}
const eased = new Map<string, EasedBox>();
let lastDrawAt: number | null = null;

/** Ease a tracked glyph's box toward its laid-out box. Returns true while it
 * is still moving. */
function easeBox(key: string, box: ScreenRect, a: number): EasedBox {
  let e = eased.get(key);
  if (!e) {
    e = { x: box.x, y: box.y, w: box.w, h: box.h, live: true };
    eased.set(key, e);
    return e;
  }
  e.live = true;
  e.x += (box.x - e.x) * a;
  e.y += (box.y - e.y) * a;
  e.w += (box.w - e.w) * a;
  e.h += (box.h - e.h) * a;
  if (
    Math.abs(box.x - e.x) < CONVERGE_EPS_PX &&
    Math.abs(box.y - e.y) < CONVERGE_EPS_PX &&
    Math.abs(box.w - e.w) < CONVERGE_EPS_PX &&
    Math.abs(box.h - e.h) < CONVERGE_EPS_PX
  ) {
    e.x = box.x;
    e.y = box.y;
    e.w = box.w;
    e.h = box.h;
  }
  return e;
}

/** Per-key start time of the re-acquired snap. */
const snapStart = new Map<string, number>();
/** Keys with a live snap this draw (reused across draws). */
const seen = new Set<string>();

/**
 * Draw one target scene at `opacity` (the layer's staleness dim). Returns
 * true while something animates (a lost fade, a re-acquired snap or a search
 * sweep), so the loop keeps drawing.
 */
export function drawTargets(
  ctx: CanvasRenderingContext2D,
  scene: TargetScene,
  s: TargetStyle,
  now: number,
  cssW: number,
  cssH: number,
  opacity = 1,
): boolean {
  let animating = false;
  seen.clear();
  // Exponential ease: the share of the remaining gap closed since the last draw.
  const dt = lastDrawAt === null ? 0 : Math.max(0, now - lastDrawAt);
  const ease = 1 - Math.exp(-dt / SMOOTH_TIME_CONSTANT_MS);
  lastDrawAt = now;
  for (const e of eased.values()) e.live = false;
  for (const l of scene.layouts) {
    const item = l.item;
    const mods = item.modifiers;
    const color = kindColor(item.kind, s);
    let alpha = opacity;
    if (item.kind === "LOST" && item.lostProgress !== undefined && !scene.reducedMotion) {
      const p = item.lostProgress + (now - scene.at) / LOST_FADE_MS;
      alpha = opacity * Math.max(0, 1 - p);
      if (alpha > 0) animating = true;
    }
    if (alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    // A tracked box eases to its new place: the whole glyph is drawn through
    // the map from its laid-out box to the eased one, in this canvas pass.
    if (!scene.reducedMotion && l.box && item.trackId != null && l.box.w > 0 && l.box.h > 0) {
      const e = easeBox(l.key, l.box, ease);
      if (e.x !== l.box.x || e.y !== l.box.y || e.w !== l.box.w || e.h !== l.box.h) {
        animating = true;
        const sx = e.w / l.box.w;
        const sy = e.h / l.box.h;
        ctx.transform(sx, 0, 0, sy, e.x - l.box.x * sx, e.y - l.box.y * sy);
      }
    }
    const p = paths(l);

    if (l.ghost.length > 1) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.6;
      ctx.setLineDash(DASH_GT);
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(l.ghost[0].x, l.ghost[0].y);
      for (let i = 1; i < l.ghost.length; i++) ctx.lineTo(l.ghost[i].x, l.ghost[i].y);
      ctx.stroke();
      ctx.restore();
    }

    const box = l.box;
    if (box && (item.kind === "CANDIDATE" || item.kind === "GT")) {
      ctx.save();
      if (item.kind === "CANDIDATE") ctx.globalAlpha = alpha * 0.7;
      if (item.kind === "GT") {
        ctx.setLineDash(DASH_GT);
        ctx.lineCap = "round";
      }
      outlinedRect(ctx, box.x, box.y, box.w, box.h, color, item.kind === "GT" ? 1.5 : 1, s);
      ctx.restore();
    }

    if (p.brackets) {
      ctx.save();
      if (mods.uncertain) ctx.globalAlpha = alpha * 0.55;
      if (item.kind === "COASTING") ctx.setLineDash(DASH_COAST);
      if (mods.reacquired && !scene.reducedMotion && box) {
        seen.add(l.key);
        let t0 = snapStart.get(l.key);
        if (t0 === undefined) {
          t0 = now;
          snapStart.set(l.key, t0);
        }
        const k = Math.min(1, (now - t0) / RE_SNAP_MS);
        if (k < 1) {
          animating = true;
          // ease-out from 1.15× to 1×, about the box centre
          const scale = 1 + 0.15 * (1 - k) * (1 - k);
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          ctx.translate(cx, cy);
          ctx.scale(scale, scale);
          ctx.translate(-cx, -cy);
        }
      }
      outlined(ctx, p.brackets, color, s.stroke, s);
      ctx.restore();
    }
    if (p.reticle) outlined(ctx, p.reticle, s.ink, 2, s);
    if (p.feet) outlined(ctx, p.feet, color, s.stroke, s);
    if (l.ring) {
      const { cx, cy, r } = l.ring;
      ctx.save();
      if (scene.reducedMotion) ctx.setLineDash(DASH_COAST);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = s.outlineColor;
      ctx.lineWidth = 1.5 + 2 * s.outline;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      if (!scene.reducedMotion) {
        animating = true;
        // A 90° arc sweeping clockwise once per period, starting at 12 o'clock.
        const a0 = -Math.PI / 2 + ((now % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + Math.PI / 2);
        ctx.strokeStyle = s.outlineColor;
        ctx.lineWidth = s.stroke + 2 * s.outline;
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = s.stroke;
        ctx.stroke();
      }
    }
    if (p.arrow) {
      ctx.strokeStyle = s.outlineColor;
      ctx.lineWidth = 2 * s.outline;
      ctx.stroke(p.arrow);
      ctx.fillStyle = color;
      ctx.fill(p.arrow);
    }
    if (l.key === scene.focusKey && (box || l.arrow)) {
      ctx.setLineDash(DASH_FOCUS);
      ctx.strokeStyle = s.ink;
      ctx.lineWidth = 2;
      if (box) {
        ctx.strokeRect(box.x - FOCUS_OFFSET, box.y - FOCUS_OFFSET, box.w + 2 * FOCUS_OFFSET, box.h + 2 * FOCUS_OFFSET);
      } else if (l.arrow) {
        ctx.strokeRect(l.arrow.x - 10, l.arrow.y - 10, 20, 20);
      }
      ctx.setLineDash(NO_DASH);
    }
    if (l.topTag) drawTag(ctx, l.topTag, l.fontPx, s);
    for (const t of l.bottomTags) drawTag(ctx, t, l.fontPx, s);
    ctx.restore();
  }
  for (const k of snapStart.keys()) if (!seen.has(k)) snapStart.delete(k);
  for (const [k, e] of eased) if (!e.live) eased.delete(k);
  drawMarks(ctx, scene.marks, scene.markFrame, s, cssW, cssH);
  return animating;
}
