/**
 * @module planner-map-helpers
 * @description Icon factories, helper functions, and constants for PlannerMap.
 * @license GPL-3.0-only
 */

import L from "leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import type { PlannerTool } from "@/lib/types";

const waypointIconCache = new Map<string, L.DivIcon>();

export function makeWaypointIcon(index: number, selected: boolean): L.DivIcon {
  const key = `${index}-${selected}`;
  const cached = waypointIconCache.get(key);
  if (cached) return cached;
  const fill = selected ? MAP_COLORS.accentSelected : MAP_COLORS.accentPrimary;
  const stroke = selected ? MAP_COLORS.accentPrimary : MAP_COLORS.foreground;
  const textFill = selected ? MAP_COLORS.background : "#fff";
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
  polygon: "crosshair",
  circle: "crosshair",
  measure: "help",
};

export const TOOL_INSTRUCTIONS: Partial<Record<PlannerTool, string>> = {
  takeoff: "Click map to place takeoff point",
  land: "Click map to place landing point",
  loiter: "Click map to place loiter point",
  roi: "Click map to set region of interest",
  rally: "Click map to place rally point",
};
