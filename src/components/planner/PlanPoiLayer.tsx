/**
 * @module PlanPoiLayer
 * @description Leaflet overlay for plan-attached Points of Interest (POIs).
 *
 * Mirrors the rally marker layer: renders a marker per POI (draggable in select
 * mode, click-to-select), and — while the "poi" tool is armed — drops a new POI
 * on each map click as one undo step on the shared planner timeline (the sticky
 * placement pattern rally uses). Placement is wired through react-leaflet
 * `useMapEvents` (the same map-click channel `CursorTracker` uses) so the layer
 * is fully self-contained. A POI is a pure GCS annotation, so nothing here
 * touches the FC. Must render inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { Fragment } from "react";
import L from "leaflet";
import { Marker, useMapEvents } from "react-leaflet";
import { MAP_COLORS } from "@/lib/map-constants";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { usePlannerStore } from "@/stores/planner-store";
import { randomId } from "@/lib/utils";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// Marker-icon cache keyed by index + selection so a re-render reuses the divIcon.
const poiIconCache = new Map<string, L.DivIcon>();

/** A violet diamond carrying the 1-based POI index (mirrors the rally triangle). */
function makePoiIcon(index: number, selected: boolean): L.DivIcon {
  const key = `${index}-${selected}`;
  const cached = poiIconCache.get(key);
  if (cached) return cached;
  // Map-layer colours (inline SVG on the Leaflet canvas), not app-chrome tokens.
  const fill = selected ? MAP_COLORS.accentSelected : MAP_COLORS.poi;
  const textFill = selected ? MAP_COLORS.background : MAP_COLORS.foreground;
  const icon = L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="14" height="14" rx="2" transform="rotate(45 11 11)" fill="${fill}" stroke="${MAP_COLORS.foreground}" stroke-width="1.2"/>
      <text x="11" y="14.5" text-anchor="middle" fill="${textFill}" font-size="8" font-family="JetBrains Mono, monospace" font-weight="600">P${index + 1}</text>
    </svg>`,
  });
  poiIconCache.set(key, icon);
  return icon;
}

const poiLabelCache = new Map<string, L.DivIcon>();
const POI_LABEL_CACHE_MAX = 200;

/** A small text chip rendered just below a POI marker for its custom label. */
function makePoiLabelIcon(text: string): L.DivIcon {
  const cached = poiLabelCache.get(text);
  if (cached) return cached;
  // Map-layer colours (inline HTML on the Leaflet canvas), not app-chrome tokens.
  const icon = L.divIcon({
    className: "",
    iconSize: [120, 16],
    // Push the chip below the 22px diamond (anchor above the label).
    iconAnchor: [60, -12],
    html: `<div style="font-size:9px;font-family:JetBrains Mono,monospace;color:${MAP_COLORS.foreground};white-space:nowrap;text-align:center;background:rgba(10,10,15,0.7);padding:1px 4px;border:1px solid rgba(168,85,247,0.5)">${escapeHtml(text)}</div>`,
  });
  if (poiLabelCache.size >= POI_LABEL_CACHE_MAX) {
    const first = poiLabelCache.keys().next().value;
    if (first !== undefined) poiLabelCache.delete(first);
  }
  poiLabelCache.set(text, icon);
  return icon;
}

/** Escape a user label before injecting it into the divIcon HTML string. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function PlanPoiLayer() {
  const points = usePlanPoiStore((s) => s.points);
  const selectedId = usePlanPoiStore((s) => s.selectedId);
  // Subscribe so markers become (un)draggable as the tool changes.
  const activeTool = usePlannerStore((s) => s.activeTool);

  // Sticky placement: each map click while the POI tool is armed drops a point,
  // recorded as a single undo step on the shared planner timeline. Read the tool
  // fresh from the store inside the handler so a stale closure never fires.
  useMapEvents({
    click(e) {
      if (usePlannerStore.getState().activeTool !== "poi") return;
      usePlanPoiStore.getState().addPoint({
        id: randomId(),
        lat: clamp(e.latlng.lat, -90, 90),
        lon: clamp(e.latlng.lng, -180, 180),
      });
    },
  });

  return (
    <>
      {points.map((p, i) => {
        const label = p.label?.trim();
        return (
          <Fragment key={p.id}>
            <Marker
              position={[p.lat, p.lon]}
              icon={makePoiIcon(i, p.id === selectedId)}
              draggable={activeTool === "select"}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent.stopPropagation();
                  usePlanPoiStore.getState().select(p.id);
                },
                dragend: (e) => {
                  const ll = e.target.getLatLng();
                  usePlanPoiStore.getState().updatePoint(p.id, { lat: ll.lat, lon: ll.lng });
                },
              }}
            />
            {label ? (
              <Marker position={[p.lat, p.lon]} icon={makePoiLabelIcon(label)} interactive={false} />
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
