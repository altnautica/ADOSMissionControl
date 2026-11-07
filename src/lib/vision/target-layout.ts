/**
 * @module vision/target-layout
 * @description Per-item layout for the HUD target layer: maps resolver items
 * (frame px) onto the rendered video rect, places the top and bottom tags,
 * hides overlapping lower-priority tags, and attaches each item's marks from
 * `target-geometry`. Pure, so every surface that draws targets lays them out
 * identically.
 *
 * @license GPL-3.0-only
 */

import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import type { RenderedRect } from "@/lib/plugins/video-overlay-props";

import {
  ARROW_INSET,
  ARROW_LEN,
  arrowPath,
  feetTickPath,
  frameToScreen,
  inflateHit,
  rectsOverlap,
  reticlePath,
  screenDirection,
  searchRing,
  type GhostSample,
  type Point,
  type ScreenRect,
} from "./target-geometry";
import {
  bracketArm,
  bracketPath,
  offFrameArrow,
  type DrawItem,
  type ResolvedTargets,
  type TagTone,
  type TargetKind,
} from "./target-state";

export const TAG_PAD = 6;
export const TAG_OFFSET = 3;
export const TAG_GAP = 4;
/** Mono advance (0.6 em) plus the 0.06 em tag tracking. */
export const TAG_CHAR_EM = 0.66;
export const CANDIDATE_TAG_MIN_H = 24;

export interface PlacedTag {
  text: string;
  tone: TagTone;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlyphLayout {
  item: DrawItem;
  /** Unique within one layout (resolver key, de-duplicated). */
  key: string;
  kind: TargetKind;
  box: ScreenRect | null;
  brackets: string | null;
  topTag: PlacedTag | null;
  bottomTags: PlacedTag[];
  reticle: string | null;
  feet: string | null;
  ring: { cx: number; cy: number; r: number } | null;
  arrow: { x: number; y: number; path: string } | null;
  /** Click target (detection-backed items only). */
  hit: ScreenRect | null;
  ghost: Point[];
  fontPx: number;
}

export interface LayoutOptions {
  rendered: RenderedRect;
  fontPx: number;
  widthClass: CockpitWidthClass;
  /** Items whose candidate tag shows even when the box is short. */
  revealKeys?: ReadonlySet<string>;
  /** Followed-box history for the COASTING ghost path. */
  ghost?: readonly GhostSample[];
}

/** Kinds drawn with corner brackets. */
const BRACKETED: Record<TargetKind, boolean> = {
  CANDIDATE: false,
  TRACKED: true,
  LOCKED: true,
  ACQUIRING: true,
  FOLLOWING: true,
  HOLDING: true,
  COASTING: true,
  SEARCHING: false,
  SEARCHING_OFFFRAME: false,
  LOST: true,
  GT: false,
};

/** Tag type size: 9 px in the PiP, 13 px at `tv`, 11 px otherwise. */
export function tagFontPx(widthClass: CockpitWidthClass, pip: boolean): number {
  if (pip) return 9;
  return widthClass === "tv" ? 13 : 11;
}

export function tagSize(text: string, fontPx: number): { w: number; h: number } {
  return { w: Math.ceil(text.length * fontPx * TAG_CHAR_EM + 2 * TAG_PAD), h: fontPx + TAG_PAD };
}

function clampX(x: number, w: number, b: RenderedRect): number {
  const max = b.left + b.width - w;
  return max < b.left ? b.left : Math.min(max, Math.max(b.left, x));
}

/** Top tag: above-left of the box, inside the box when that leaves the
 * rendered rect, clamped horizontally. */
export function placeTopTag(box: ScreenRect, size: { w: number; h: number }, b: RenderedRect): Point {
  let y = box.y - TAG_OFFSET - size.h;
  if (y < b.top) y = box.y + TAG_OFFSET;
  return { x: clampX(box.x, size.w, b), y };
}

/** Bottom tags: centred under the box, 4 px apart, inside the box bottom when
 * below would leave the rendered rect. */
export function placeBottomTags(
  box: ScreenRect,
  sizes: readonly { w: number; h: number }[],
  b: RenderedRect,
): Point[] {
  if (sizes.length === 0) return [];
  const total = sizes.reduce((s, z) => s + z.w, 0) + TAG_GAP * (sizes.length - 1);
  const h = Math.max(...sizes.map((z) => z.h));
  let y = box.y + box.h + TAG_OFFSET;
  if (y + h > b.top + b.height) y = box.y + box.h - TAG_OFFSET - h;
  let x = clampX(box.x + box.w / 2 - total / 2, total, b);
  return sizes.map((z) => {
    const p = { x, y };
    x += z.w + TAG_GAP;
    return p;
  });
}

/** Top-left of a tag sitting inward of an off-frame arrow, clamped into the
 * rendered rect. */
export function arrowTagPos(
  x: number,
  y: number,
  relDeg: number,
  size: { w: number; h: number },
  b: RenderedRect,
  len = ARROW_LEN,
): Point {
  const d = screenDirection(relDeg);
  const reach = len / 2 + TAG_GAP + Math.abs(d.x) * (size.w / 2) + Math.abs(d.y) * (size.h / 2);
  const cx = x - d.x * reach;
  const cy = y - d.y * reach;
  const top = Math.min(b.top + b.height - size.h, Math.max(b.top, cy - size.h / 2));
  return { x: clampX(cx - size.w / 2, size.w, b), y: top };
}

function topTagText(item: DrawItem, widthClass: CockpitWidthClass): string | null {
  if (!item.topTag) return null;
  if (widthClass === "compact") {
    if (item.kind === "CANDIDATE") return null;
    if (item.kind === "TRACKED" && item.trackId !== null) return `#${item.trackId}`;
  }
  return item.topTag.text;
}

/** Lay out every resolved item over the rendered video rect. */
export function layoutTargets(resolved: ResolvedTargets, o: LayoutOptions): GlyphLayout[] {
  const { rendered: rr, fontPx } = o;
  const out: GlyphLayout[] = [];
  const seen = new Set<string>();
  const shownTopTags: ScreenRect[] = [];

  resolved.items.forEach((item, i) => {
    const key = seen.has(item.key) ? `${item.key}:${i}` : item.key;
    seen.add(key);
    const frameRect = item.rect;
    const box = frameRect ? frameToScreen(frameRect, resolved.frameW, resolved.frameH, rr) : null;

    const g: GlyphLayout = {
      item,
      key,
      kind: item.kind,
      box,
      brackets: null,
      topTag: null,
      bottomTags: [],
      reticle: null,
      feet: null,
      ring: null,
      arrow: null,
      hit: item.detection && box ? inflateHit(box) : null,
      ghost: [],
      fontPx,
    };

    // Anchor rect the top tag sits against.
    let anchor: ScreenRect | null = box;
    if (box && BRACKETED[item.kind]) {
      g.brackets = bracketPath(box.x, box.y, box.w, box.h, bracketArm(box.w, box.h));
    }
    if (box && item.reticle) g.reticle = reticlePath(box);
    if (box && item.feetTick) g.feet = feetTickPath(box);
    if (box && item.kind === "SEARCHING") {
      g.ring = searchRing(box);
      anchor = { x: g.ring.cx - g.ring.r, y: g.ring.cy - g.ring.r, w: 2 * g.ring.r, h: 2 * g.ring.r };
    }
    if (box && item.kind === "COASTING" && o.ghost && o.ghost.length > 0) {
      const sx = resolved.frameW > 0 ? rr.width / resolved.frameW : 0;
      const sy = resolved.frameH > 0 ? rr.height / resolved.frameH : 0;
      g.ghost = o.ghost.map((p) => ({ x: rr.left + p.x * sx, y: rr.top + p.y * sy }));
      g.ghost.push({ x: box.x + box.w / 2, y: box.y + box.h });
    }

    const text = topTagText(item, o.widthClass);
    const tone = item.topTag?.tone ?? "ink";
    if (item.kind === "SEARCHING_OFFFRAME" && item.relBearingDeg !== undefined) {
      const p = offFrameArrow(item.relBearingDeg, rr, ARROW_INSET);
      g.arrow = { x: p.x, y: p.y, path: arrowPath(p.x, p.y, item.relBearingDeg) };
      if (text) {
        const size = tagSize(text, fontPx);
        const at = arrowTagPos(p.x, p.y, item.relBearingDeg, size, rr);
        g.topTag = { text, tone, ...at, ...size };
      }
    } else if (anchor && text) {
      const hideShort =
        item.kind === "CANDIDATE" && anchor.h < CANDIDATE_TAG_MIN_H && !o.revealKeys?.has(key);
      if (!hideShort) {
        const size = tagSize(text, fontPx);
        g.topTag = { text, tone, ...placeTopTag(anchor, size, rr), ...size };
      }
    }

    if (g.topTag) {
      if (shownTopTags.some((r) => rectsOverlap(r, g.topTag!))) g.topTag = null;
      else shownTopTags.push(g.topTag);
    }

    if (box && item.bottomTags.length > 0) {
      const sizes = item.bottomTags.map((t) => tagSize(t.text, fontPx));
      const at = placeBottomTags(box, sizes, rr);
      g.bottomTags = item.bottomTags.map((t, k) => ({ ...t, ...at[k], ...sizes[k] }));
    }
    out.push(g);
  });
  return out;
}
