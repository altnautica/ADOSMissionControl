/**
 * @module planner-map-helpers
 * @description Icon factories, helper functions, constants and the hint-banner
 * descriptor for PlannerMap.
 * @license GPL-3.0-only
 */

import L from "leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import type { PlannerTool } from "@/lib/types";
import type { PlannerMode } from "@/lib/planner-mode";
import { datumPatternFor } from "@/lib/planner-mode";

const waypointIconCache = new Map<string, L.DivIcon>();

export function makeWaypointIcon(index: number, selected: boolean): L.DivIcon {
  const key = `${index}-${selected}`;
  const cached = waypointIconCache.get(key);
  if (cached) return cached;
  const fill = selected ? MAP_COLORS.accentSelected : MAP_COLORS.accentPrimary;
  const stroke = selected ? MAP_COLORS.accentPrimary : MAP_COLORS.foreground;
  const textFill = selected ? MAP_COLORS.background : MAP_COLORS.foreground;
  const icon = L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      <text x="12" y="16" text-anchor="middle" fill="${textFill}" font-size="11" font-family="JetBrains Mono, monospace" font-weight="600">${index + 1}</text>
    </svg>`,
  });
  waypointIconCache.set(key, icon);
  return icon;
}

const splineIconCache = new Map<string, L.DivIcon>();

export function makeSplineWaypointIcon(index: number, selected: boolean): L.DivIcon {
  const key = `spline-${index}-${selected}`;
  const cached = splineIconCache.get(key);
  if (cached) return cached;
  const fill = selected ? MAP_COLORS.accentSelected : MAP_COLORS.background;
  const stroke = MAP_COLORS.spline;
  const textFill = selected ? MAP_COLORS.background : MAP_COLORS.spline;
  const icon = L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4 2"/>
      <text x="12" y="16" text-anchor="middle" fill="${textFill}" font-size="11" font-family="JetBrains Mono, monospace" font-weight="600">${index + 1}</text>
    </svg>`,
  });
  splineIconCache.set(key, icon);
  return icon;
}

const segmentLabelCache = new Map<string, L.DivIcon>();
const SEGMENT_CACHE_MAX = 200;

export function makeSegmentLabel(text: string): L.DivIcon {
  const cached = segmentLabelCache.get(text);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "",
    iconSize: [80, 16],
    iconAnchor: [40, 8],
    html: `<div style="font-size:9px;font-family:JetBrains Mono,monospace;color:${MAP_COLORS.muted};white-space:nowrap;text-align:center;background:rgba(10,10,15,0.7);padding:1px 4px;border:1px solid rgba(255,255,255,0.1)">${text}</div>`,
  });
  if (segmentLabelCache.size >= SEGMENT_CACHE_MAX) {
    const first = segmentLabelCache.keys().next().value;
    if (first !== undefined) segmentLabelCache.delete(first);
  }
  segmentLabelCache.set(text, icon);
  return icon;
}

const rallyIconCache = new Map<number, L.DivIcon>();

export function makeRallyIcon(index: number): L.DivIcon {
  const cached = rallyIconCache.get(index);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <polygon points="11,2 20,19 2,19" fill="${MAP_COLORS.rally}" stroke="${MAP_COLORS.foreground}" stroke-width="1.2"/>
      <text x="11" y="16" text-anchor="middle" fill="${MAP_COLORS.foreground}" font-size="9" font-family="JetBrains Mono, monospace" font-weight="600">R${index + 1}</text>
    </svg>`,
  });
  rallyIconCache.set(index, icon);
  return icon;
}

const measureLabelCache = new Map<string, L.DivIcon>();
const MEASURE_CACHE_MAX = 200;

export function makeMeasureLabel(text: string): L.DivIcon {
  const cached = measureLabelCache.get(text);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "",
    iconSize: [120, 20],
    iconAnchor: [60, -4],
    html: `<div style="font-size:10px;font-family:JetBrains Mono,monospace;color:${MAP_COLORS.foreground};white-space:nowrap;text-align:center;background:rgba(10,10,15,0.85);padding:2px 6px;border:1px solid ${MAP_COLORS.muted}">${text}</div>`,
  });
  if (measureLabelCache.size >= MEASURE_CACHE_MAX) {
    const first = measureLabelCache.keys().next().value;
    if (first !== undefined) measureLabelCache.delete(first);
  }
  measureLabelCache.set(text, icon);
  return icon;
}

export function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

export const DRAWING_TOOLS: PlannerTool[] = ["polygon", "circle", "measure"];
export const PLACEMENT_TOOLS: PlannerTool[] = ["waypoint", "takeoff", "land", "loiter", "roi", "rally"];

export const TOOL_CURSORS: Record<PlannerTool, string> = {
  select: "default",
  waypoint: "crosshair",
  takeoff: "crosshair",
  land: "crosshair",
  loiter: "crosshair",
  roi: "crosshair",
  rally: "crosshair",
  poi: "crosshair",
  polygon: "crosshair",
  circle: "crosshair",
  measure: "help",
  datum: "crosshair",
};

/**
 * A single in-map hint surface. `tone` controls whether the banner reads as the
 * always-on subdued select hint or the louder accent hint shown while an
 * explicit placement / drawing mode is armed.
 */
export interface BannerDescriptor {
  readonly message: string;
  readonly tone: "subdued" | "accent";
}

/**
 * Map the authoritative interaction mode to the hint banner shown over the map.
 * Pure: no React, no leaflet, no store access — every placement, draw, datum,
 * and rally mode resolves to one consistent descriptor here so the map renders a
 * single banner driven by `mode.kind` instead of several bespoke blocks.
 *
 * Returns `null` for the rare modes that should show no banner (none today; the
 * select mode keeps a subdued always-on hint).
 */
export function mapBannerDescriptor(mode: PlannerMode): BannerDescriptor | null {
  switch (mode.kind) {
    case "select":
      return { message: "Click map to add a waypoint", tone: "subdued" };
    case "waypoint":
      switch (mode.tool) {
        case "waypoint":
          return { message: "Click map to place waypoint", tone: "accent" };
        case "takeoff":
          return { message: "Click map to place takeoff point", tone: "accent" };
        case "land":
          return { message: "Click map to place landing point", tone: "accent" };
        case "loiter":
          return { message: "Click map to place loiter point", tone: "accent" };
        case "roi":
          return { message: "Click map to set region of interest", tone: "accent" };
      }
    // falls through (every waypoint tool is handled above)
    case "rally":
      return { message: "Click map to place rally point", tone: "accent" };
    case "poi":
      return { message: "Click map to place a point of interest", tone: "accent" };
    case "datum": {
      // Reflect the armed search pattern so the operator knows which point the
      // next click sets (a parallel-track sets a start point, the radial patterns
      // set a centre datum; with no pattern armed, prompt them to pick one).
      const pattern = datumPatternFor(mode);
      if (pattern === "parallelTrack") {
        return { message: "Click map to set the search start point", tone: "accent" };
      }
      if (pattern === "expandingSquare" || pattern === "sectorSearch") {
        return { message: "Click map to set the search datum point", tone: "accent" };
      }
      if (pattern === null) {
        return { message: "Select a search pattern, then click map to set its datum", tone: "accent" };
      }
      // survey / orbit / corridor / structureScan set their area by drawing, so a
      // datum click does nothing — say so rather than promise a datum placement.
      return { message: "This pattern's area is set by drawing, not a datum click", tone: "accent" };
    }
    case "draw":
      switch (mode.shape) {
        case "polygon":
          return {
            message:
              "Click to place vertices. Right-click or click first vertex to close. Backspace to undo. Escape to cancel.",
            tone: "accent",
          };
        case "circle":
          return { message: "Click and drag to draw circle. Right-click to cancel.", tone: "accent" };
        case "measure":
          return { message: "Click to add points, double-click to finish. Right-click to cancel.", tone: "accent" };
      }
  }
  return null;
}
