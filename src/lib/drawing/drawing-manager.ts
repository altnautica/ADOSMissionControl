/** Manages Leaflet drawing interactions for polygon, circle, and measure tools. */

import L from "leaflet";
import type { DrawingMode } from "./types";
import { haversineDistance, formatDistance, polygonArea, formatArea } from "./geo-utils";
import { DRAW_COLORS, makeVertexIcon, makeDistanceLabel, makeAreaLabel } from "./drawing-labels";
import { type MeasureState, createMeasureState, addMeasurePoint, updateMeasureLine, emitMeasureUpdate, clearMeasureState } from "./drawing-measure";

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

  // Bound handlers (for cleanup)
  private boundClick: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundDblClick: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMouseMove: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMouseDown: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundMouseUp: ((e: L.LeafletMouseEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(map: L.Map, callbacks: DrawingCallbacks = {}) {
    this.map = map;
    this.callbacks = callbacks;
    this.drawingGroup = L.featureGroup().addTo(map);
  }

  setCallbacks(callbacks: DrawingCallbacks): void { this.callbacks = callbacks; }
  getMode(): DrawingMode { return this.mode; }
  getVertexCount(): number { return this.polygonVertices.length; }

  // ── Polygon Drawing ──────────────────────────────────────────

  startPolygonDraw(): void {
    this.cancelDraw();
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
    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.cancelDraw();
      if (e.key === "Backspace" && this.polygonVertices.length > 0) {
        e.preventDefault();
        this.polygonVertices.pop();
        const lastMarker = this.polygonMarkers.pop();
        if (lastMarker) this.drawingGroup.removeLayer(lastMarker);
        this.updatePolygonShape();
        this.callbacks.onVerticesUpdate?.(this.polygonVertices);
      }
    };

    this.map.on("click", this.boundClick);
    this.map.on("dblclick", this.boundDblClick);
    this.map.on("mousemove", this.boundMouseMove);
    document.addEventListener("keydown", this.boundKeyDown);
    this.map.doubleClickZoom.disable();
  }

  private addPolygonVertex(lat: number, lon: number): void {
    // BUG-7: Snap-to-close when clicking near first vertex with >= 3 vertices
    if (this.polygonVertices.length >= 3) {
      const first = this.polygonVertices[0];
      const firstPx = this.map.latLngToContainerPoint(L.latLng(first[0], first[1]));
      const clickPx = this.map.latLngToContainerPoint(L.latLng(lat, lon));
      const pxDist = firstPx.distanceTo(clickPx);
      if (pxDist <= 20) {
        this.completePolygon();
        return;
      }
    }

    this.polygonVertices.push([lat, lon]);
    const marker = L.marker([lat, lon], { icon: makeVertexIcon(), interactive: false }).addTo(this.drawingGroup);
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
        icon: makeAreaLabel(formatArea(area)), interactive: false,
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
  }

  private completePolygon(): void {
    if (this.polygonVertices.length < 3) return;
    const vertices = [...this.polygonVertices];
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
        icon: makeDistanceLabel(`r = ${formatDistance(radius)}`), interactive: false,
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
    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (this.circleIsDragging) { this.map.dragging.enable(); }
        this.cancelDraw();
      }
    };

    this.map.on("mousedown", this.boundMouseDown);
    this.map.on("mousemove", this.boundMouseMove);
    this.map.on("mouseup", this.boundMouseUp);
    document.addEventListener("keydown", this.boundKeyDown);
  }

  // ── Measure Tool (delegated to drawing-measure.ts) ─────────

  startMeasure(): void {
    this.cancelDraw();
    this.mode = "measure";
    this.ms = createMeasureState();

    this.boundClick = (e: L.LeafletMouseEvent) => {
      if (this.mode !== "measure") return;
      addMeasurePoint(this.ms, e.latlng.lat, e.latlng.lng, this.drawingGroup);
      updateMeasureLine(this.ms, this.map, this.drawingGroup);
      emitMeasureUpdate(this.ms, this.callbacks);
    };
    this.boundDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      this.completeMeasure();
    };
    this.boundMouseMove = (e: L.LeafletMouseEvent) => {
      if (this.ms.measurePoints.length === 0) return;
      if (this.polygonPreviewLine) { this.drawingGroup.removeLayer(this.polygonPreviewLine); this.polygonPreviewLine = null; }
      const last = this.ms.measurePoints[this.ms.measurePoints.length - 1];
      this.polygonPreviewLine = L.polyline(
        [[last[0], last[1]], [e.latlng.lat, e.latlng.lng]],
        { color: DRAW_COLORS.measure, weight: 1.5, dashArray: "3 3", opacity: 0.5 }
      ).addTo(this.drawingGroup);
    };
    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.completeMeasure();
    };

    this.map.on("click", this.boundClick);
    this.map.on("dblclick", this.boundDblClick);
    this.map.on("mousemove", this.boundMouseMove);
    document.addEventListener("keydown", this.boundKeyDown);
    this.map.doubleClickZoom.disable();
  }

  private completeMeasure(): void {
    emitMeasureUpdate(this.ms, this.callbacks);
    this.removeDrawingListeners();
    this.mode = null;
    this.map.doubleClickZoom.enable();
  }

  // ── Cancel / Cleanup ──────────────────────────────────────

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
    if (this.boundKeyDown) { document.removeEventListener("keydown", this.boundKeyDown); this.boundKeyDown = null; }
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
    // Circle
    this.circleCenter = null;
    this.circleIsDragging = false;
    if (this.circleCenterMarker) { this.drawingGroup.removeLayer(this.circleCenterMarker); this.circleCenterMarker = null; }
    if (this.circleShape) { this.drawingGroup.removeLayer(this.circleShape); this.circleShape = null; }
    if (this.circleRadiusLabel) { this.drawingGroup.removeLayer(this.circleRadiusLabel); this.circleRadiusLabel = null; }
    // Measure
    clearMeasureState(this.ms, this.drawingGroup);
  }

  destroy(): void {
    this.cancelDraw();
    this.map.removeLayer(this.drawingGroup);
  }
}
