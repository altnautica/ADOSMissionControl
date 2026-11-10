/**
 * @module cockpit/flight/flight-grid/zones
 * @description The flight screen's zone geometry, from the cockpit spec
 * (`layout.json` zones and per-class sizes). One pure function turns the
 * cockpit container's size into a rectangle per zone, and every zone
 * component is placed from it, so the zones cannot overlap by construction
 * and a test can check the same rectangles the screen uses.
 *
 * Landscape classes put the top bar across the top, the left and right
 * columns down the sides between the top bar and the bottom zone, and the
 * bottom-left card, the bottom row and the skills chip along the bottom. In
 * following mode the follow strip sits directly under the top bar, between
 * the columns; the centre is what is left between them. Portrait stacks the
 * follow strip (when up) under the top bar, then the video (16:9), the Vision
 * view's panel, the left column as a row, the skills chip, the bottom row and
 * the map card.
 *
 * @license GPL-3.0-only
 */

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { clampSplit } from "@/lib/cockpit/views";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";

export type FlightGridClass = CockpitWidthClass | "portrait";

export type FlightZoneId =
  | "top_bar"
  | "left_column"
  | "right_column"
  | "center"
  | "bottom_left_card"
  | "bottom_row"
  | "follow_strip"
  | "bottom_right"
  | "side_panel"
  | "video";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlightGrid {
  cls: FlightGridClass;
  widthClass: CockpitWidthClass;
  /** Size multiplier for the chrome (1.33 on tv). */
  scale: number;
  width: number;
  height: number;
  /** Every zone drawn at this size; a zone absent here is not drawn. */
  zones: Partial<Record<FlightZoneId, Rect>>;
  /** The STOP button's slot at the right end of the top bar. */
  stop: Rect;
  /** Left column target size (px). */
  target: number;
  /** The bottom-left card renders as a small square chip (compact). */
  cardIsChip: boolean;
  /** The video's share of the Split view's picture slot, inside the
   * divider's limits. */
  split: number;
}

export interface FlightGridInput {
  width: number;
  height: number;
  widthClass: CockpitWidthClass;
  /** Follow-me is engaged: the follow strip opens under the top bar. */
  following?: boolean;
  /** A side panel (the Vision view) takes this width at the right edge; in
   * portrait it stacks under the video instead. */
  sidePanelWidth?: number;
  /** The video's share of the Split view (clamped to the divider's limits). */
  splitRatio?: number;
}

type ClassSpec = (typeof layoutSpec.classes)[keyof typeof layoutSpec.classes];

const CHROME = tokens.chrome;
const EDGE = CHROME.edge_inset_px;
const GAP = CHROME.gap_px;
const TOP_BAR_H = 44;
const TOP_BAR_H_COMPACT = 40;
const ROW_H = 48;
const ROW_H_COMPACT = 40;
/** The follow strip: 48 px controls with a 4 px margin above and below. */
const STRIP_H = 56;
const SKILLS_W = 132;
const SKILLS_H = 44;
const STOP_W = 76;
const STOP_W_COMPACT = 60;
const STOP_PAD = 4;
const PORTRAIT_ROW_H = 56;
const PORTRAIT_MIN_CARD_H = 120;
/** Height the side columns need for their controls (the right column's
 * shutter, photo/video switch, zoom and camera settings at 48 px targets,
 * plus the recording timer), unscaled. */
export const COLUMN_MIN_H = 242;
/** Smallest bottom-left card height on a short landscape screen (a phone
 * held landscape, 412 px tall, keeps the columns their full height). */
const MIN_CARD_H = 90;
/** The Vision view's panel height when portrait stacks it under the video. */
const PORTRAIT_PANEL_H = 180;

/** The grid class: portrait whenever the container is taller than wide. */
export function flightGridClass(
  width: number,
  height: number,
  widthClass: CockpitWidthClass,
): FlightGridClass {
  return height > width ? "portrait" : widthClass;
}

/** A rectangle snapped to whole pixels. */
export function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function stopSlot(bar: Rect, compact: boolean, s: number): Rect {
  const w = (compact ? STOP_W_COMPACT : STOP_W) * s;
  return roundRect({ x: bar.x + bar.w - STOP_PAD * s - w, y: bar.y + STOP_PAD * s, w, h: bar.h - 2 * STOP_PAD * s });
}

function portraitGrid(i: FlightGridInput): FlightGrid {
  const { width: W, height: H } = i;
  const s = 1;
  const full = W - 2 * EDGE;
  const bar = { x: EDGE, y: EDGE, w: full, h: TOP_BAR_H_COMPACT };
  let y = bar.y + bar.h + GAP;
  const strip = i.following ? { x: EDGE, y, w: full, h: STRIP_H } : null;
  if (strip) y = strip.y + strip.h + GAP;
  const video = { x: 0, y, w: W, h: (W * 9) / 16 };
  y = video.y + video.h + GAP;
  const panel = (i.sidePanelWidth ?? 0) > 0 ? { x: EDGE, y, w: full, h: PORTRAIT_PANEL_H } : null;
  if (panel) y = panel.y + panel.h + GAP;
  const left = { x: EDGE, y, w: full, h: PORTRAIT_ROW_H };
  const skills = { x: EDGE, y: left.y + left.h + GAP, w: full, h: SKILLS_H };
  const row = { x: EDGE, y: skills.y + skills.h + GAP, w: full, h: ROW_H };
  const cardY = row.y + row.h + GAP;
  const card = { x: EDGE, y: cardY, w: full, h: Math.max(PORTRAIT_MIN_CARD_H, H - EDGE - cardY) };
  const zones: FlightGrid["zones"] = {
    top_bar: roundRect(bar),
    video: roundRect(video),
    center: roundRect(video),
    left_column: roundRect(left),
    bottom_right: roundRect(skills),
    bottom_row: roundRect(row),
    bottom_left_card: roundRect(card),
  };
  if (strip) zones.follow_strip = roundRect(strip);
  if (panel) zones.side_panel = roundRect(panel);
  return {
    cls: "portrait",
    widthClass: i.widthClass,
    scale: s,
    width: W,
    height: H,
    zones,
    stop: stopSlot(bar, true, s),
    target: layoutSpec.touch_target.left_column,
    cardIsChip: false,
    split: clampSplit(i.splitRatio),
  };
}

/** The zone rectangles for a cockpit container of this size. */
export function flightGrid(i: FlightGridInput): FlightGrid {
  const cls = flightGridClass(i.width, i.height, i.widthClass);
  if (cls === "portrait") return portraitGrid(i);
  const spec = layoutSpec.classes[cls] as ClassSpec & {
    column_width: number;
    bottom_left_card: { kind: string; size?: number; width?: number; height?: number };
    scale: number;
  };
  const s = spec.scale;
  const compact = cls === "compact";
  const { width: W, height: H } = i;
  const e = EDGE * s;
  const g = GAP * s;
  const topH = (compact ? TOP_BAR_H_COMPACT : TOP_BAR_H) * s;
  const rowH = (compact ? ROW_H_COMPACT : ROW_H) * s;
  const colW = spec.column_width * s;
  const chip = spec.bottom_left_card.kind === "chip";
  const specCardW = (chip ? (spec.bottom_left_card.size ?? 96) : (spec.bottom_left_card.width ?? 280)) * s;
  const specCardH = (chip ? (spec.bottom_left_card.size ?? 96) : (spec.bottom_left_card.height ?? 180)) * s;
  const skillsW = SKILLS_W * s;
  const skillsH = (compact ? ROW_H_COMPACT : SKILLS_H) * s;
  const y0 = e + topH + g;
  // A short screen (a phone held landscape) shrinks the card, keeping its
  // shape, so the columns keep the room their controls need.
  const cardRoom = H - e - g - y0 - COLUMN_MIN_H * s;
  const cardH = chip ? specCardH : Math.max(MIN_CARD_H * s, Math.min(specCardH, cardRoom));
  const cardW = chip ? specCardW : (specCardW * cardH) / specCardH;
  const bottomH = Math.max(cardH, rowH, skillsH);

  const bar = { x: e, y: e, w: W - 2 * e, h: topH };
  const y1 = H - e - bottomH - g;
  const panelW = i.sidePanelWidth ?? 0;
  const rightEdge = W - e - (panelW > 0 ? panelW + g : 0);
  const left = { x: e, y: y0, w: colW, h: y1 - y0 };
  const right = { x: rightEdge - colW, y: y0, w: colW, h: y1 - y0 };
  // Between the columns: the follow strip right under the top bar (when up),
  // then the centre.
  const midX = left.x + left.w + g;
  const midW = right.x - g - midX;
  const strip = i.following ? { x: midX, y: y0, w: midW, h: STRIP_H * s } : null;
  const centerY = strip ? strip.y + strip.h + g : y0;
  const center = { x: midX, y: centerY, w: midW, h: y1 - centerY };
  const card = { x: e, y: H - e - cardH, w: cardW, h: cardH };
  const skills = { x: W - e - skillsW, y: H - e - skillsH, w: skillsW, h: skillsH };
  const rowX = card.x + card.w + g;
  const row = { x: rowX, y: H - e - rowH, w: skills.x - g - rowX, h: rowH };

  const zones: FlightGrid["zones"] = {
    top_bar: roundRect(bar),
    left_column: roundRect(left),
    right_column: roundRect(right),
    center: roundRect(center),
    bottom_left_card: roundRect(card),
    bottom_row: roundRect(row),
    bottom_right: roundRect(skills),
  };
  if (strip) zones.follow_strip = roundRect(strip);
  const panelX = W - e - panelW;
  if (panelW > 0) zones.side_panel = roundRect({ x: panelX, y: y0, w: panelW, h: H - e - y0 - skillsH - g });
  return {
    cls,
    widthClass: i.widthClass,
    scale: s,
    width: W,
    height: H,
    zones,
    stop: stopSlot(bar, compact, s),
    target: (compact ? layoutSpec.touch_target.min : layoutSpec.touch_target.left_column) * s,
    cardIsChip: chip,
    split: clampSplit(i.splitRatio),
  };
}

/** Whether two rectangles share any area (touching edges do not count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether `inner` lies fully inside `outer`. */
export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Absolute-position style for a zone rectangle. */
export function rectStyle(r: Rect): { left: number; top: number; width: number; height: number } {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}
