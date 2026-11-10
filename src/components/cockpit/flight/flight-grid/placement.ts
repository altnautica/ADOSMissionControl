/**
 * @module cockpit/flight/flight-grid/placement
 * @description What the flight screen places inside the zone grid: the main
 * picture per view, the Split view's map pane and divider, the column the
 * flow overlays stack in, the bottom row's label mode, and the centre
 * heading and no-video placeholder offsets. Pure functions of a
 * {@link FlightGrid}, so a test checks the same rectangles the screen uses.
 *
 * @license GPL-3.0-only
 */

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { SPLIT_DIVIDER, clampSplit, type CockpitViewId } from "@/lib/cockpit/views";
import { roundRect, type FlightGrid, type Rect } from "./zones";

const EDGE = tokens.chrome.edge_inset_px;
const GAP = tokens.chrome.gap_px;

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
  if (grid.cls === "portrait") return roundRect({ x, y: map.y, w, h: map.h });
  const g = GAP * grid.scale;
  const z = grid.zones;
  const top = Math.max(edgeBottom(z.top_bar), edgeBottom(z.follow_strip)) + g;
  const bottom = Math.min(z.bottom_row?.y ?? grid.height, z.bottom_left_card?.y ?? grid.height, z.bottom_right?.y ?? grid.height) - g;
  return roundRect({ x, y: top, w, h: Math.max(0, bottom - top) });
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
    return roundRect({ x: e, y, w: grid.width - 2 * e, h: Math.max(0, end - y) });
  }
  const left = z.left_column;
  const right = z.right_column;
  const x = Math.round(left ? left.x + left.w + g : centre.x);
  const r = Math.round(right ? right.x - g : centre.x + centre.w);
  return roundRect({ x, y, w: r - x, h: Math.max(0, end - y) });
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
