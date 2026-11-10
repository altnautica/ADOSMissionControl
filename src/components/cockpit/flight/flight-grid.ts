/**
 * @module cockpit/flight/flight-grid
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
import viewsSpec from "@/lib/cockpit-spec/views.json";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import type { CockpitViewId } from "@/lib/cockpit/views";

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

interface DividerSpec {
  default: number;
  min: number;
  max: number;
}
const DIVIDER = (viewsSpec.views.find((v) => v.id === "split") as { divider?: DividerSpec } | undefined)?.divider;

/** The Split view's divider (`views.json` split `divider`): the video's share
 * of the picture slot, its default and its limits. */
export const SPLIT_DIVIDER: DividerSpec = {
  default: DIVIDER?.default ?? 0.5,
  min: DIVIDER?.min ?? 0.3,
  max: DIVIDER?.max ?? 0.7,
};

/** A Split ratio inside the divider's limits; no ratio is the default. */
export function clampSplit(ratio: number | null | undefined): number {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return SPLIT_DIVIDER.default;
  return Math.min(SPLIT_DIVIDER.max, Math.max(SPLIT_DIVIDER.min, ratio));
}

/** The grid class: portrait whenever the container is taller than wide. */
export function flightGridClass(
  width: number,
  height: number,
  widthClass: CockpitWidthClass,
): FlightGridClass {
  return height > width ? "portrait" : widthClass;
}

function round(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function stopSlot(bar: Rect, compact: boolean, s: number): Rect {
  const w = (compact ? STOP_W_COMPACT : STOP_W) * s;
  return round({ x: bar.x + bar.w - STOP_PAD * s - w, y: bar.y + STOP_PAD * s, w, h: bar.h - 2 * STOP_PAD * s });
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
    top_bar: round(bar),
    video: round(video),
    center: round(video),
    left_column: round(left),
    bottom_right: round(skills),
    bottom_row: round(row),
    bottom_left_card: round(card),
  };
  if (strip) zones.follow_strip = round(strip);
  if (panel) zones.side_panel = round(panel);
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
    top_bar: round(bar),
    left_column: round(left),
    right_column: round(right),
    center: round(center),
    bottom_left_card: round(card),
    bottom_row: round(row),
    bottom_right: round(skills),
  };
  if (strip) zones.follow_strip = round(strip);
  const panelX = W - e - panelW;
  if (panelW > 0) zones.side_panel = round({ x: panelX, y: y0, w: panelW, h: H - e - y0 - skillsH - g });
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

/**
 * Where the main picture sits for a view at this grid, in screen pixels. In
 * the Map view it is the bottom-left card; in the Split view it is the slot's
 * share left of the divider (the slot is the whole screen, or the video zone
 * in portrait). The video inside is letterboxed (`object-fit: contain`), so
 * its centre is this rect's centre.
 */
export function videoRect(view: CockpitViewId, grid: FlightGrid): Rect {
  const full = { x: 0, y: 0, w: grid.width, h: grid.height };
  const video = grid.zones.video;
  if (view === "map") return grid.zones.bottom_left_card ?? full;
  if (view === "split") {
    const slot = splitSlot(grid);
    return { x: slot.x, y: slot.y, w: Math.round(slot.w * grid.split), h: slot.h };
  }
  if (grid.cls === "portrait" && video) return video;
  if (view === "vision" && grid.zones.side_panel) return { x: 0, y: 0, w: grid.zones.side_panel.x, h: grid.height };
  return full;
}

/** The picture slot the Split view divides: the whole screen, or the video
 * zone in portrait, so the map never leaves the video's place. */
function splitSlot(grid: FlightGrid): Rect {
  const video = grid.zones.video;
  return grid.cls === "portrait" && video ? video : { x: 0, y: 0, w: grid.width, h: grid.height };
}

/** The Split view's map pane: the slot's share right of the divider. */
export function splitMapRect(grid: FlightGrid): Rect {
  const slot = splitSlot(grid);
  const x = slot.x + Math.round(slot.w * grid.split);
  return { x, y: slot.y, w: slot.x + slot.w - x, h: slot.h };
}

/**
 * The Split divider's handle: a touch-size strip centred on the boundary
 * between the video and the map. In landscape it runs from under the top bar
 * (and the follow strip) down to the bottom zones; in portrait it spans the
 * video zone.
 */
export function splitDividerRect(grid: FlightGrid): Rect {
  const map = splitMapRect(grid);
  const w = layoutSpec.touch_target.min * grid.scale;
  const x = map.x - w / 2;
  if (grid.cls === "portrait") return round({ x, y: map.y, w, h: map.h });
  const g = GAP * grid.scale;
  const z = grid.zones;
  const top = Math.max(edgeBottom(z.top_bar), edgeBottom(z.follow_strip)) + g;
  const bottom = Math.min(z.bottom_row?.y ?? grid.height, z.bottom_left_card?.y ?? grid.height, z.bottom_right?.y ?? grid.height) - g;
  return round({ x, y: top, w, h: Math.max(0, bottom - top) });
}

/** The Split ratio for a pointer at `x` (screen pixels), inside the limits. */
export function splitFromPointer(x: number, grid: FlightGrid): number {
  const slot = splitSlot(grid);
  return clampSplit(slot.w > 0 ? (x - slot.x) / slot.w : SPLIT_DIVIDER.default);
}

function edgeBottom(r: Rect | undefined): number {
  return r ? r.y + r.h : 0;
}

/**
 * The column the flow overlays (handover banner, countdowns, sticks-with,
 * the centre-sticks ring) stack in: top-centre, starting under the follow
 * strip (or the top bar), spanning between the side columns (the full width
 * in portrait), down to the bottom of the centre.
 */
export function flowColumn(grid: FlightGrid): Rect {
  const z = grid.zones;
  const g = GAP * grid.scale;
  const y = Math.max(edgeBottom(z.top_bar), edgeBottom(z.follow_strip)) + g;
  const centre = z.center ?? { x: 0, y: 0, w: grid.width, h: grid.height };
  const end = centre.y + centre.h;
  if (grid.cls === "portrait") {
    const e = EDGE * grid.scale;
    return round({ x: e, y, w: grid.width - 2 * e, h: Math.max(0, end - y) });
  }
  const left = z.left_column;
  const right = z.right_column;
  const x = Math.round(left ? left.x + left.w + g : centre.x);
  const r = Math.round(right ? right.x - g : centre.x + centre.w);
  return round({ x, y, w: r - x, h: Math.max(0, end - y) });
}

/** The bottom row's narrowest width (unscaled) that holds all five readouts
 * (D, H, H.S, V.S, AGL) at the value type size without two touching. */
export const BOTTOM_ROW_FULL_MIN_W = 448;

/** Which readouts the bottom row shows: all five, or distance and height. */
export type BottomRowLabels = "full" | "distance_only";

/** The bottom row's label mode, from the row's own width at this grid. */
export function bottomRowLabels(grid: FlightGrid): BottomRowLabels {
  const row = grid.zones.bottom_row;
  return row && row.w >= BOTTOM_ROW_FULL_MIN_W * grid.scale ? "full" : "distance_only";
}

/** The heading readout's top above the picture centre (`.fs-centre-hdg`). */
export const CENTRE_HEADING_RISE_PX = 132;
const CENTRE_HEADING_GAP_PX = 4;

/**
 * The heading readout's top inside the picture box `pic`, in pixels. It sits
 * {@link CENTRE_HEADING_RISE_PX} above the picture centre, but never under the
 * top bar or the follow strip: in portrait the picture is a short 16:9 strip
 * just below them.
 */
export function centreHeadingTop(pic: Rect, grid: FlightGrid): number {
  const chrome = Math.max(edgeBottom(grid.zones.top_bar), edgeBottom(grid.zones.follow_strip));
  const below = chrome > 0 ? chrome + CENTRE_HEADING_GAP_PX - pic.y : CENTRE_HEADING_GAP_PX;
  return Math.max(pic.h / 2 - CENTRE_HEADING_RISE_PX, below, CENTRE_HEADING_GAP_PX);
}

/** How far below the picture centre the no-video placeholder starts: below
 * the centre marks (a 200 px box) and the horizon mark's full pitch travel. */
export const PLACEHOLDER_DROP_PX = 108;
