/**
 * Measure tool logic extracted from DrawingManager.
 *
 * Provides startMeasure, addMeasurePoint, updateMeasureLine,
 * updateMeasurePreview, emitMeasureUpdate, completeMeasure methods.
 *
 * @module drawing/drawing-measure
 * @license GPL-3.0-only
 */

import L from "leaflet";
import { formatDistance } from "@/lib/units/format";
import type { UnitSystem } from "@/stores/settings-store-types";
import { DRAW_COLORS, makeVertexIcon, makeDistanceLabel, makeTotalLabel } from "./drawing-labels";
import { haversineDistance } from "@/lib/geo/distance";

export interface MeasureCallbacks {
  onMeasureUpdate?: (
    points: [number, number][],
    segmentDistances: number[],
    totalDistance: number
  ) => void;
}

export interface MeasureState {
  measurePoints: [number, number][];
  measureMarkers: L.Marker[];
  measureLine: L.Polyline | null;
  measureLabels: L.Marker[];
  measureTotalLabel: L.Marker | null;
}

export function createMeasureState(): MeasureState {
  return {
    measurePoints: [],
    measureMarkers: [],
    measureLine: null,
    measureLabels: [],
    measureTotalLabel: null,
  };
}

export function addMeasurePoint(
  state: MeasureState,
  lat: number,
  lon: number,
  drawingGroup: L.FeatureGroup,
): void {
  state.measurePoints.push([lat, lon]);
  const marker = L.marker([lat, lon], {
    icon: makeVertexIcon(DRAW_COLORS.measure), interactive: false,
  }).addTo(drawingGroup);
  state.measureMarkers.push(marker);
}

export function updateMeasureLine(
  state: MeasureState,
  map: L.Map,
  drawingGroup: L.FeatureGroup,
  unitSystem: UnitSystem,
): void {
  if (state.measureLine) { drawingGroup.removeLayer(state.measureLine); state.measureLine = null; }
  for (const label of state.measureLabels) { drawingGroup.removeLayer(label); }
  state.measureLabels = [];
  if (state.measureTotalLabel) { drawingGroup.removeLayer(state.measureTotalLabel); state.measureTotalLabel = null; }

  if (state.measurePoints.length < 2) return;

  state.measureLine = L.polyline(
    state.measurePoints.map((p) => [p[0], p[1]] as L.LatLngTuple),
    { color: DRAW_COLORS.measure, weight: 2, dashArray: DRAW_COLORS.measureDash, opacity: 0.9 }
  ).addTo(drawingGroup);

  let total = 0;
  for (let i = 1; i < state.measurePoints.length; i++) {
    const prev = state.measurePoints[i - 1];
    const curr = state.measurePoints[i];
    const dist = haversineDistance(prev[0], prev[1], curr[0], curr[1]);
    total += dist;

    const midLat = (prev[0] + curr[0]) / 2;
    const midLon = (prev[1] + curr[1]) / 2;
    const label = L.marker([midLat, midLon], {
      icon: makeDistanceLabel(formatDistance(dist, unitSystem)), interactive: false,
    }).addTo(drawingGroup);
    state.measureLabels.push(label);
  }

  if (state.measurePoints.length >= 2) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    state.measureTotalLabel = L.marker([last[0], last[1]], {
      icon: makeTotalLabel(`Total: ${formatDistance(total, unitSystem)}`), interactive: false,
    }).addTo(drawingGroup);
    const offset = map.latLngToContainerPoint([last[0], last[1]]);
    const newLatLng = map.containerPointToLatLng([offset.x, offset.y - 20]);
    state.measureTotalLabel.setLatLng(newLatLng);
  }
}

export function emitMeasureUpdate(
  state: MeasureState,
  callbacks: MeasureCallbacks,
): void {
  const segmentDistances: number[] = [];
  let total = 0;
  for (let i = 1; i < state.measurePoints.length; i++) {
    const prev = state.measurePoints[i - 1];
    const curr = state.measurePoints[i];
    const dist = haversineDistance(prev[0], prev[1], curr[0], curr[1]);
    segmentDistances.push(dist);
    total += dist;
  }
  callbacks.onMeasureUpdate?.([...state.measurePoints], segmentDistances, total);
}

export function clearMeasureState(
  state: MeasureState,
  drawingGroup: L.FeatureGroup,
): void {
  state.measurePoints = [];
  for (const m of state.measureMarkers) drawingGroup.removeLayer(m);
  state.measureMarkers = [];
  if (state.measureLine) { drawingGroup.removeLayer(state.measureLine); state.measureLine = null; }
  for (const l of state.measureLabels) drawingGroup.removeLayer(l);
  state.measureLabels = [];
  if (state.measureTotalLabel) { drawingGroup.removeLayer(state.measureTotalLabel); state.measureTotalLabel = null; }
}
