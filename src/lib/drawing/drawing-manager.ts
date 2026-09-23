/**
 * Manages Leaflet drawing interactions for polygon, circle, and measure tools.
 *
 * The manager owns only mouse / map interaction. Keyboard control (Escape to
 * cancel, Backspace to pop a vertex, complete-on-key) is NOT owned here: it lives
 * in the single planner keyboard dispatcher, which calls the imperative methods
 * exposed below (popVertex / complete / cancelDraw). This keeps one ordered
 * keyboard owner instead of competing document listeners.
 */

import L from "leaflet";
import type { DrawingMode } from "./types";
import { haversineDistance, polygonArea, polygonCentroid, nearestVertexWithinThreshold } from "./geo-utils";
import { formatArea, formatDistance } from "@/lib/units/format";
import type { UnitSystem } from "@/stores/settings-store-types";
import { DRAW_COLORS, makeVertexIcon, makeDistanceLabel, makeAreaLabel } from "./drawing-labels";
import { type MeasureState, createMeasureState, addMeasurePoint, updateMeasureLine, emitMeasureUpdate, clearMeasureState } from "./drawing-measure";

/** Pixel radius within which a new vertex snaps onto an existing vertex / waypoint. */
const SNAP_TARGET_PX = 12;

interface DrawingCallbacks {
  onPolygonComplete?: (vertices: [number, number][]) => void;
  onCircleComplete?: (center: [number, number], radius: number) => void;
  onMeasureUpdate?: (
    points: [number, number][],
    segmentDistances: number[],
    totalDistance: number
  ) => void;
  onVerticesUpdate?: (vertices: [number, number][]) => void;
  onCancel?: () => void;
}

export class DrawingManager {
  private map: L.Map;
  private drawingGroup: L.FeatureGroup;
  private callbacks: DrawingCallbacks;
  private mode: DrawingMode = null;

  // Polygon state
  private polygonVertices: [number, number][] = [];
  private polygonMarkers: L.Marker[] = [];
  private polygonLine: L.Polyline | null = null;
  private polygonPreviewLine: L.Polyline | null = null;
  private polygonFill: L.Polygon | null = null;
  private polygonAreaLabel: L.Marker | null = null;
  private snapIndicator: L.CircleMarker | null = null;

  // Circle state
  private circleCenter: [number, number] | null = null;
  private circleCenterMarker: L.Marker | null = null;
  private circleShape: L.Circle | null = null;
  private circleRadiusLabel: L.Marker | null = null;
  private circleIsDragging = false;

  // Measure state (delegated)
  private ms: MeasureState = createMeasureState();
  private measureAreaLabel: L.Marker | null = null;

  // Snap-while-drawing: external vertices/waypoints a new vertex can snap onto,
  // and the unit system the area readouts format in. Both default to inert
  // values (no snapping, metric) so the manager stays store-free; the map
  // component feeds live values via the setters below.
  private snapTargets: [number, number][] = [];
  private unitSystem: UnitSystem = "metric";

  // Bound handlers (for cleanup)
  private boundClick: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundDblClick: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMouseMove: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMouseDown: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMouseUp: ((e: L.LeafletMouseEvent) => void) | null = null;

  constructor(map: L.Map, callbacks: DrawingCallbacks = {}) {
    this.map = map;
    this.callbacks = callbacks;
    this.drawingGroup = L.featureGroup().addTo(map);
  }

  setCallbacks(callbacks: DrawingCallbacks): void { this.callbacks = callbacks; }
  getMode(): DrawingMode { return this.mode; }
  getVertexCount(): number { return this.polygonVertices.length; }

  /**
   * Set the vertices a new polygon/measure vertex may snap onto while drawing
   * (existing drawn-shape vertices + waypoints). Pass an empty array to disable.
   */
  setSnapTargets(targets: [number, number][]): void { this.snapTargets = targets; }

  /** Set the unit system the distance and area readouts format in (metric / imperial). */
  setUnitSystem(system: UnitSystem): void { this.unitSystem = system; }

  /**
   * Snap [lat, lon] onto the nearest external snap target within a small pixel
   * radius, or return null when none is close. The pure decision lives in
   * geo-utils; this only supplies the live map projection.
   */
  private snapToTarget(lat: number, lon: number): [number, number] | null {
    return nearestVertexWithinThreshold(
      [lat, lon],
      this.snapTargets,
      (ll) => this.map.latLngToContainerPoint(L.latLng(ll[0], ll[1])),
      SNAP_TARGET_PX
    );
  }

  /**
   * The first polygon vertex when the cursor is within the close-threshold of it
   * (3+ vertices placed), else null. Drives both snap-to-close on click and the
   * close affordance during preview.
   */
  private nearFirstVertex(lat: number, lon: number): [number, number] | null {
    if (this.polygonVertices.length < 3) return null;
    const first = this.polygonVertices[0];
    const firstPx = this.map.latLngToContainerPoint(L.latLng(first[0], first[1]));
    const cursorPx = this.map.latLngToContainerPoint(L.latLng(lat, lon));
    return firstPx.distanceTo(cursorPx) <= 20 ? first : null;
  }

  /** Create the snap affordance marker if absent, else move it to `latlng`. */
  private showSnapIndicator(latlng: [number, number]): void {
    if (!this.snapIndicator) {
      this.snapIndicator = L.circleMarker([latlng[0], latlng[1]], {
        radius: 8, color: DRAW_COLORS.stroke, weight: 2, fillOpacity: 0.3, fillColor: DRAW_COLORS.stroke,
      }).addTo(this.drawingGroup);
    } else {
      this.snapIndicator.setLatLng([latlng[0], latlng[1]]);
    }
  }

  // ── Polygon Drawing ──────────────────────────────────────────

  startPolygonDraw(): void {
    this.cancelDraw();
    this.clearFinishedMeasure();
    this.mode = "polygon";
    this.polygonVertices = [];

    this.boundClick = (e: L.LeafletMouseEvent) => {
      if (this.mode !== "polygon") return;
      this.addPolygonVertex(e.latlng.lat, e.latlng.lng);
    };
    this.boundDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      if (this.polygonVertices.length >= 3) this.completePolygon();
    };
    this.boundMouseMove = (e: L.LeafletMouseEvent) => {
      this.updatePolygonPreview(e.latlng.lat, e.latlng.lng);
    };

    this.map.on("click", this.boundClick);
    this.map.on("dblclick", this.boundDblClick);
    this.map.on("mousemove", this.boundMouseMove);
    this.map.doubleClickZoom.disable();
  }

  /**
   * Remove the most recent polygon vertex (the Backspace-while-drawing gesture).
   * Only meaningful while drawing a polygon with at least one vertex; a no-op
   * otherwise. Called by the planner keyboard dispatcher, not a document listener.
   */
  popVertex(): void {
    if (this.mode !== "polygon" || this.polygonVertices.length === 0) return;
    this.polygonVertices.pop();
    const lastMarker = this.polygonMarkers.pop();
    if (lastMarker) this.drawingGroup.removeLayer(lastMarker);
    this.updatePolygonShape();
    this.callbacks.onVerticesUpdate?.(this.polygonVertices);
  }

  /**
   * Complete the in-progress draw: finish the polygon when 3+ vertices exist, or
   * finish a measurement. A no-op in any other state. Lets the keyboard
   * dispatcher (e.g. Enter) finish a draw without the manager owning the key.
   */
  complete(): void {
    if (this.mode === "polygon") {
      if (this.polygonVertices.length >= 3) this.completePolygon();
      return;
    }
    if (this.mode === "measure") {
      this.completeMeasure();
    }
  }

  private addPolygonVertex(lat: number, lon: number): void {
    // Snap-to-close when clicking near the first vertex with 3+ vertices.
    if (this.nearFirstVertex(lat, lon)) {
      this.completePolygon();
      return;
    }

    // Snap the new vertex onto a nearby existing vertex / waypoint when in range.
    const snapped = this.snapToTarget(lat, lon);
    const [vLat, vLon] = snapped ?? [lat, lon];

    this.polygonVertices.push([vLat, vLon]);
    const marker = L.marker([vLat, vLon], { icon: makeVertexIcon(), interactive: false }).addTo(this.drawingGroup);
    this.polygonMarkers.push(marker);
    this.updatePolygonShape();
    this.callbacks.onVerticesUpdate?.(this.polygonVertices);
  }

  private updatePolygonShape(): void {
    if (this.polygonLine) { this.drawingGroup.removeLayer(this.polygonLine); this.polygonLine = null; }
    if (this.polygonFill) { this.drawingGroup.removeLayer(this.polygonFill); this.polygonFill = null; }
    if (this.polygonAreaLabel) { this.drawingGroup.removeLayer(this.polygonAreaLabel); this.polygonAreaLabel = null; }

    if (this.polygonVertices.length >= 2) {
      this.polygonLine = L.polyline(
        this.polygonVertices.map((v) => [v[0], v[1]] as L.LatLngTuple),
        { color: DRAW_COLORS.stroke, weight: 2, opacity: 0.8 }
      ).addTo(this.drawingGroup);
    }
    if (this.polygonVertices.length >= 3) {
      this.polygonFill = L.polygon(
        this.polygonVertices.map((v) => [v[0], v[1]] as L.LatLngTuple),
        { color: DRAW_COLORS.stroke, weight: 2, fillColor: DRAW_COLORS.fill, fillOpacity: 0.15, opacity: 0.8 }
      ).addTo(this.drawingGroup);
      const area = polygonArea(this.polygonVertices);
      const cLat = this.polygonVertices.reduce((s, v) => s + v[0], 0) / this.polygonVertices.length;
      const cLon = this.polygonVertices.reduce((s, v) => s + v[1], 0) / this.polygonVertices.length;
      this.polygonAreaLabel = L.marker([cLat, cLon], {
        icon: makeAreaLabel(formatArea(area, this.unitSystem)), interactive: false,
      }).addTo(this.drawingGroup);
    }
  }

  private updatePolygonPreview(lat: number, lon: number): void {
    if (this.polygonVertices.length === 0) return;
    if (this.polygonPreviewLine) { this.drawingGroup.removeLayer(this.polygonPreviewLine); this.polygonPreviewLine = null; }
    const last = this.polygonVertices[this.polygonVertices.length - 1];
    this.polygonPreviewLine = L.polyline(
      [[last[0], last[1]], [lat, lon]],
      { color: DRAW_COLORS.preview, weight: 2, dashArray: "4 4", opacity: 0.7 }
    ).addTo(this.drawingGroup);

    // Snap affordance: closing onto the first vertex takes priority, then snapping
    // onto a nearby existing vertex / waypoint.
    const close = this.nearFirstVertex(lat, lon);
    if (close) { this.showSnapIndicator(close); return; }
    const snapped = this.snapToTarget(lat, lon);
    if (snapped) { this.showSnapIndicator(snapped); return; }
    this.removeSnapIndicator();
  }

  private removeSnapIndicator(): void {
    if (this.snapIndicator) {
      this.drawingGroup.removeLayer(this.snapIndicator);
      this.snapIndicator = null;
    }
  }

  completePolygon(): void {
    if (this.polygonVertices.length < 3) return;

    // Remove trailing duplicate vertices added by Leaflet's double-click
    // (Leaflet fires two click events before dblclick, adding duplicates at the close position).
    while (this.polygonVertices.length > 3) {
      const last = this.polygonVertices[this.polygonVertices.length - 1];
      const prev = this.polygonVertices[this.polygonVertices.length - 2];
      if (haversineDistance(last[0], last[1], prev[0], prev[1]) < 1) {
        this.polygonVertices.pop();
      } else {
        break;
      }
    }

    const vertices = [...this.polygonVertices];
    this.removeSnapIndicator();
    this.removeDrawingListeners();
    this.mode = null;
    this.map.doubleClickZoom.enable();
    this.callbacks.onPolygonComplete?.(vertices);
    // Delay clearing so React renders the store-driven polygon first
    requestAnimationFrame(() => this.clearDrawingLayers());
  }

  // ── Circle Drawing ──────────────────────────────────────────

  startCircleDraw(): void {
    this.cancelDraw();
    this.clearFinishedMeasure();
    this.mode = "circle";
    this.circleCenter = null;
    this.circleIsDragging = false;

    this.boundMouseDown = (e: L.LeafletMouseEvent) => {
      if (this.mode !== "circle") return;
      L.DomEvent.stop(e);
      this.circleCenter = [e.latlng.lat, e.latlng.lng];
      this.circleIsDragging = true;
      this.circleCenterMarker = L.marker([e.latlng.lat, e.latlng.lng], {
        icon: makeVertexIcon(), interactive: false,
      }).addTo(this.drawingGroup);
      this.circleShape = L.circle([e.latlng.lat, e.latlng.lng], {
        radius: 0, color: DRAW_COLORS.stroke, weight: 2,
        fillColor: DRAW_COLORS.fill, fillOpacity: 0.15, opacity: 0.8,
      }).addTo(this.drawingGroup);
      this.map.dragging.disable();
    };
    this.boundMouseMove = (e: L.LeafletMouseEvent) => {
      if (!this.circleIsDragging || !this.circleCenter || !this.circleShape) return;
      const radius = haversineDistance(this.circleCenter[0], this.circleCenter[1], e.latlng.lat, e.latlng.lng);
      this.circleShape.setRadius(radius);
      if (this.circleRadiusLabel) { this.drawingGroup.removeLayer(this.circleRadiusLabel); }
      const midLat = (this.circleCenter[0] + e.latlng.lat) / 2;
      const midLon = (this.circleCenter[1] + e.latlng.lng) / 2;
      this.circleRadiusLabel = L.marker([midLat, midLon], {
        icon: makeDistanceLabel(`r = ${formatDistance(radius, this.unitSystem)}`), interactive: false,
      }).addTo(this.drawingGroup);
    };
    this.boundMouseUp = (e: L.LeafletMouseEvent) => {
      if (!this.circleIsDragging || !this.circleCenter) return;
      this.circleIsDragging = false;
      this.map.dragging.enable();
      const radius = haversineDistance(this.circleCenter[0], this.circleCenter[1], e.latlng.lat, e.latlng.lng);
      if (radius < 1) { this.clearDrawingLayers(); return; }
      const center: [number, number] = [...this.circleCenter];
      this.removeDrawingListeners();
      this.clearDrawingLayers();
      this.mode = null;
      this.callbacks.onCircleComplete?.(center, radius);
    };
    this.map.on("mousedown", this.boundMouseDown);
    this.map.on("mousemove", this.boundMouseMove);
    this.map.on("mouseup", this.boundMouseUp);
  }

  // ── Measure Tool (delegated to drawing-measure.ts) ─────────

  startMeasure(): void {
    this.cancelDraw();
    this.clearFinishedMeasure();
    this.mode = "measure";

    this.boundClick = (e: L.LeafletMouseEvent) => {
      if (this.mode !== "measure") return;
      const snapped = this.snapToTarget(e.latlng.lat, e.latlng.lng);
      const [lat, lon] = snapped ?? [e.latlng.lat, e.latlng.lng];
      addMeasurePoint(this.ms, lat, lon, this.drawingGroup);
      updateMeasureLine(this.ms, this.map, this.drawingGroup, this.unitSystem);
      this.updateMeasureAreaLabel();
      emitMeasureUpdate(this.ms, this.callbacks);
    };
    this.boundDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      this.completeMeasure();
    };
    this.boundMouseMove = (e: L.LeafletMouseEvent) => {
      const snapped = this.snapToTarget(e.latlng.lat, e.latlng.lng);
      if (snapped) this.showSnapIndicator(snapped); else this.removeSnapIndicator();
      if (this.ms.measurePoints.length === 0) return;
      if (this.polygonPreviewLine) { this.drawingGroup.removeLayer(this.polygonPreviewLine); this.polygonPreviewLine = null; }
      const last = this.ms.measurePoints[this.ms.measurePoints.length - 1];
      this.polygonPreviewLine = L.polyline(
        [[last[0], last[1]], [e.latlng.lat, e.latlng.lng]],
        { color: DRAW_COLORS.measure, weight: 1.5, dashArray: "3 3", opacity: 0.5 }
      ).addTo(this.drawingGroup);
    };
    this.map.on("click", this.boundClick);
    this.map.on("dblclick", this.boundDblClick);
    this.map.on("mousemove", this.boundMouseMove);
    this.map.doubleClickZoom.disable();
  }

  private completeMeasure(): void {
    emitMeasureUpdate(this.ms, this.callbacks);
    this.removeDrawingListeners();
    this.removeSnapIndicator();
    this.mode = null;
    this.map.doubleClickZoom.enable();
  }

  /**
   * Show (or refresh) the enclosed-area readout for the measured line once it
   * forms a closed shape (3+ points). The points are treated as a ring, so the
   * area sits alongside the per-segment and total-perimeter distance labels.
   */
  private updateMeasureAreaLabel(): void {
    if (this.measureAreaLabel) { this.drawingGroup.removeLayer(this.measureAreaLabel); this.measureAreaLabel = null; }
    const pts = this.ms.measurePoints;
    if (pts.length < 3) return;
    const area = polygonArea(pts);
    const [cLat, cLon] = polygonCentroid(pts);
    this.measureAreaLabel = L.marker([cLat, cLon], {
      icon: makeAreaLabel(`Area: ${formatArea(area, this.unitSystem)}`), interactive: false,
    }).addTo(this.drawingGroup);
  }

  // ── Cancel / Cleanup ──────────────────────────────────────

  /**
   * A completed measurement stays on the map until the next tool starts;
   * cancelDraw is a no-op then (mode is already null), so its layers are
   * removed here before the next drawing begins.
   */
  private clearFinishedMeasure(): void {
    clearMeasureState(this.ms, this.drawingGroup);
    if (this.measureAreaLabel) { this.drawingGroup.removeLayer(this.measureAreaLabel); this.measureAreaLabel = null; }
  }

  cancelDraw(): void {
    if (this.mode === null) return;
    const wasCircleDragging = this.circleIsDragging;
    this.removeDrawingListeners();
    this.clearDrawingLayers();
    this.mode = null;
    this.map.doubleClickZoom.enable();
    if (wasCircleDragging) { this.map.dragging.enable(); }
    this.callbacks.onCancel?.();
  }

  clearAll(): void {
    this.cancelDraw();
    this.drawingGroup.clearLayers();
  }

  private removeDrawingListeners(): void {
    if (this.boundClick) { this.map.off("click", this.boundClick); this.boundClick = null; }
    if (this.boundDblClick) { this.map.off("dblclick", this.boundDblClick); this.boundDblClick = null; }
    if (this.boundMouseMove) { this.map.off("mousemove", this.boundMouseMove); this.boundMouseMove = null; }
    if (this.boundMouseDown) { this.map.off("mousedown", this.boundMouseDown); this.boundMouseDown = null; }
    if (this.boundMouseUp) { this.map.off("mouseup", this.boundMouseUp); this.boundMouseUp = null; }
  }

  private clearDrawingLayers(): void {
    // Polygon
    this.polygonVertices = [];
    for (const m of this.polygonMarkers) this.drawingGroup.removeLayer(m);
    this.polygonMarkers = [];
    if (this.polygonLine) { this.drawingGroup.removeLayer(this.polygonLine); this.polygonLine = null; }
    if (this.polygonPreviewLine) { this.drawingGroup.removeLayer(this.polygonPreviewLine); this.polygonPreviewLine = null; }
    if (this.polygonFill) { this.drawingGroup.removeLayer(this.polygonFill); this.polygonFill = null; }
    if (this.polygonAreaLabel) { this.drawingGroup.removeLayer(this.polygonAreaLabel); this.polygonAreaLabel = null; }
    this.removeSnapIndicator();
    // Circle
    this.circleCenter = null;
    this.circleIsDragging = false;
    if (this.circleCenterMarker) { this.drawingGroup.removeLayer(this.circleCenterMarker); this.circleCenterMarker = null; }
    if (this.circleShape) { this.drawingGroup.removeLayer(this.circleShape); this.circleShape = null; }
    if (this.circleRadiusLabel) { this.drawingGroup.removeLayer(this.circleRadiusLabel); this.circleRadiusLabel = null; }
    this.clearFinishedMeasure();
  }

  destroy(): void {
    this.cancelDraw();
    this.map.removeLayer(this.drawingGroup);
  }
}

/**
 * The imperative drawing surface the single planner keyboard dispatcher acts on.
 * The map component registers the live manager here; the dispatcher reads it.
 * This is the seam that lets one keyboard owner reach the active draw without the
 * manager registering its own document listeners.
 */
export interface ActiveDrawApi {
  /** True while a polygon / circle / measure draw is in progress. */
  isDrawing(): boolean;
  /** Cancel the active draw (Escape). No-op when not drawing. */
  cancel(): void;
  /** Remove the last polygon vertex (Backspace while drawing). No-op otherwise. */
  popVertex(): void;
  /** Finish the active draw (e.g. Enter). No-op when not completable. */
  complete(): void;
}

let activeDrawApi: ActiveDrawApi | null = null;

/**
 * Register (or clear, with `null`) the active draw surface. The map component
 * calls this when its manager is created / torn down so the keyboard dispatcher
 * can reach the live draw. A single global is correct here: only one planner map
 * is mounted at a time.
 */
export function registerActiveDrawApi(api: ActiveDrawApi | null): void {
  activeDrawApi = api;
}

/** Read the currently registered active draw surface, or `null` when none. */
export function getActiveDrawApi(): ActiveDrawApi | null {
  return activeDrawApi;
}
