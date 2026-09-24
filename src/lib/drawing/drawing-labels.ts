/**
 * @module drawing/drawing-labels
 * @description Leaflet DivIcon factories for drawing tool labels and vertices.
 * @license GPL-3.0-only
 */

import L from "leaflet";

export const DRAW_COLORS = {
  stroke: "#3a82ff",
  fill: "rgba(58, 130, 255, 0.15)",
  vertex: "#ffffff",
  vertexStroke: "#3a82ff",
  preview: "rgba(58, 130, 255, 0.5)",
  measure: "#ffffff",
  measureDash: "6 4",
  label: "rgba(10, 10, 15, 0.85)",
  labelText: "#ffffff",
  labelBorder: "rgba(58, 130, 255, 0.4)",
} as const;

export function makeVertexIcon(color: string = DRAW_COLORS.vertex): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    html: `<div style="width:10px;height:10px;background:${color};border:1.5px solid ${DRAW_COLORS.vertexStroke};box-sizing:border-box"></div>`,
  });
}

export function makeDistanceLabel(text: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [100, 20],
    iconAnchor: [50, 10],
    html: `<div style="font-size:10px;font-family:JetBrains Mono,monospace;color:${DRAW_COLORS.labelText};white-space:nowrap;text-align:center;background:${DRAW_COLORS.label};padding:2px 6px;border:1px solid rgba(255,255,255,0.15)">${text}</div>`,
  });
}

export function makeAreaLabel(text: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [140, 24],
    iconAnchor: [70, 12],
    html: `<div style="font-size:11px;font-family:JetBrains Mono,monospace;color:${DRAW_COLORS.labelText};white-space:nowrap;text-align:center;background:${DRAW_COLORS.label};padding:3px 8px;border:1px solid rgba(58,130,255,0.4)">${text}</div>`,
  });
}

export function makeTotalLabel(text: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [140, 24],
    iconAnchor: [70, 12],
    html: `<div style="font-size:11px;font-family:JetBrains Mono,monospace;color:${DRAW_COLORS.stroke};white-space:nowrap;text-align:center;background:${DRAW_COLORS.label};padding:3px 8px;border:1px solid ${DRAW_COLORS.labelBorder};font-weight:600">${text}</div>`,
  });
}
