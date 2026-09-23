/**
 * @module PlannerMap
 * @description Leaflet-based mission planner map component. Renders waypoint markers
 * (draggable in select mode), path polyline, segment distance/bearing labels,
 * drawing overlays (polygon, circle, measure), and handles click/right-click/drag events.
 * Uses dark CARTO tiles.
 * @license GPL-3.0-only
 */
"use client";

import { memo, useEffect, useMemo, useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { Waypoint, PlannerTool } from "@/lib/types";
import type { RallyPoint } from "@/stores/rally-store";
import type { DrawnPolygon, DrawnCircle } from "@/lib/drawing/types";
import { bearing } from "@/lib/telemetry-utils";
import { MAP_COLORS } from "@/lib/map-constants";
import { useDefaultCenter } from "@/hooks/use-default-center";
import { DrawingManager, registerActiveDrawApi } from "@/lib/drawing/drawing-manager";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useRallyStore } from "@/stores/rally-store";
import { useSettingsStore } from "@/stores/settings-store";
import { polygonArea } from "@/lib/drawing/geo-utils";
import { randomId } from "@/lib/utils";
import L from "leaflet";
import {
  makeWaypointIcon, makeSplineWaypointIcon, makeSegmentLabel, makeRallyIcon, makeMeasureLabel, formatDist,
  DRAWING_TOOLS, PLACEMENT_TOOLS, TOOL_CURSORS, mapBannerDescriptor,
} from "./planner-map-helpers";
import { PlannerGpsBadge, PlannerGuidanceVectors } from "./PlannerLiveVehicle";
import { generateSplinePath } from "@/lib/spline-interpolation";
import { withPlannerHistory } from "@/lib/planner-history";
import { JumpArrowOverlay } from "./JumpArrowOverlay";
import { FleetPluginSlot } from "@/components/plugins/FleetPluginSlot";
import { useMapEvents } from "react-leaflet";
import { CURSOR_MOVE_EVENT } from "@/lib/planner/cursor-coord";
import { haversineDistance } from "@/lib/geo/distance";

/**
 * In-map tracker that reports the cursor's map coordinate to the bottom-right
 * coordinate widget. Lives inside the MapContainer so `useMapEvents` has the
 * leaflet context, renders nothing, and dispatches a lightweight DOM CustomEvent
 * (a null payload on mouse-out) rather than routing a per-move value through a
 * store.
 */
function CursorTracker() {
  useMapEvents({
    mousemove(e) {
      window.dispatchEvent(
        new CustomEvent(CURSOR_MOVE_EVENT, { detail: { lat: e.latlng.lat, lon: e.latlng.lng } }),
      );
    },
    mouseout() {
      window.dispatchEvent(new CustomEvent(CURSOR_MOVE_EVENT, { detail: null }));
    },
  });
  return null;
}

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayerSwitcher = dynamic(() => import("@/components/map/TileLayerSwitcher").then((m) => ({ default: m.TileLayerSwitcher })), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const GcsMarker = dynamic(() => import("@/components/map/GcsMarker").then((m) => ({ default: m.GcsMarker })), { ssr: false });
const PatternOverlay = memo(dynamic(() => import("@/components/planner/PatternOverlay").then((m) => ({ default: m.PatternOverlay })), { ssr: false }));
const LocateControl = dynamic(() => import("@/components/map/LocateControl").then((m) => ({ default: m.LocateControl })), { ssr: false });
const KmlOverlayLayers = memo(dynamic(() => import("@/components/planner/KmlOverlayLayers").then((m) => ({ default: m.KmlOverlayLayers })), { ssr: false }));
const RasterOverlay = dynamic(() => import("@/components/planner/RasterOverlay").then((m) => ({ default: m.RasterOverlay })), { ssr: false });
const CoverageOverlay = memo(dynamic(() => import("@/components/planner/CoverageOverlay").then((m) => ({ default: m.CoverageOverlay })), { ssr: false }));
const GuidanceSettingsMenu = dynamic(() => import("@/components/shared/GuidanceSettingsMenu").then((m) => ({ default: m.GuidanceSettingsMenu })), { ssr: false });
const EditableGeofenceOverlay = dynamic(() => import("@/components/map/EditableGeofenceOverlay").then((m) => ({ default: m.EditableGeofenceOverlay })), { ssr: false });
const PlanPoiLayer = memo(dynamic(() => import("@/components/planner/PlanPoiLayer").then((m) => ({ default: m.PlanPoiLayer })), { ssr: false }));
const GeofenceZonesOverlay = dynamic(() => import("@/components/map/GeofenceZonesOverlay").then((m) => ({ default: m.GeofenceZonesOverlay })), { ssr: false });


/** Static layer styles, hoisted so react-leaflet never restyles on re-render. */
const SPLINE_PATH_STYLE = { color: MAP_COLORS.spline, weight: 2.5, opacity: 0.9 };
const MEASURE_PATH_STYLE = { color: MAP_COLORS.muted, weight: 2, dashArray: "4 4" };

interface PlannerMapProps {
  waypoints: Waypoint[];
  activeTool: PlannerTool;
  selectedWaypointId: string | null;
  hasActivePlan: boolean;
  rallyPoints?: RallyPoint[];
  onMapClick: (lat: number, lon: number) => void;
  onMapRightClick: (lat: number, lon: number, x: number, y: number) => void;
  /** additive = ctrl/meta (toggle), range = shift (select range). */
  onWaypointClick: (id: string, additive?: boolean, range?: boolean) => void;
  onWaypointDragEnd: (id: string, lat: number, lon: number) => void;
  onWaypointRightClick: (id: string, x: number, y: number) => void;
  onDrawingComplete?: (shape: DrawnPolygon | DrawnCircle) => void;
}

export function PlannerMap({
  waypoints, activeTool, selectedWaypointId, hasActivePlan, rallyPoints = [],
  onMapClick, onMapRightClick, onWaypointClick, onWaypointDragEnd, onWaypointRightClick, onDrawingComplete,
}: PlannerMapProps) {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [zoom, setZoom] = useState(13);
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const drawingMode = useDrawingStore((s) => s.drawingMode);
  const setDrawingMode = useDrawingStore((s) => s.setDrawingMode);
  const addPolygon = useDrawingStore((s) => s.addPolygon);
  const addCircle = useDrawingStore((s) => s.addCircle);
  const setMeasureLine = useDrawingStore((s) => s.setMeasureLine);
  const setActiveDrawingVertices = useDrawingStore((s) => s.setActiveDrawingVertices);
  const measureLine = useDrawingStore((s) => s.measureLine);
  const drawnPolysForSnap = useDrawingStore((s) => s.polygons);
  const drawnCircsForSnap = useDrawingStore((s) => s.circles);
  const unitSystem = useSettingsStore((s) => s.units);
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  // Authoritative interaction mode drives the single in-map hint banner.
  const mode = usePlannerStore((s) => s.mode);
  const fitRequestTs = usePlannerStore((s) => s.fitRequestTs);
  const clearFitRequest = usePlannerStore((s) => s.clearFitRequest);
  const defaultCenter = useDefaultCenter();

  useEffect(() => {
    if (!mapInstance) return;
    const manager = new DrawingManager(mapInstance);
    drawingManagerRef.current = manager;
    // Expose the manager's draw control to the single planner keyboard
    // dispatcher. The manager owns mouse/map interaction only; the dispatcher
    // owns the keys and calls these methods.
    registerActiveDrawApi({
      isDrawing: () => manager.getMode() !== null,
      cancel: () => manager.cancelDraw(),
      popVertex: () => manager.popVertex(),
      complete: () => manager.complete(),
    });
    return () => { registerActiveDrawApi(null); manager.destroy(); drawingManagerRef.current = null; };
  }, [mapInstance]);

  // Feed the drawing manager the operator's unit system (for the measure/area
  // labels) and the vertices a new draw can snap onto (waypoints + drawn shapes).
  useEffect(() => {
    drawingManagerRef.current?.setUnitSystem(unitSystem);
  }, [unitSystem, mapInstance]);
  useEffect(() => {
    const targets: [number, number][] = [
      ...waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]),
      ...drawnPolysForSnap.flatMap((poly) => poly.vertices),
      ...drawnCircsForSnap.map((circ) => circ.center),
    ];
    drawingManagerRef.current?.setSnapTargets(targets);
  }, [waypoints, drawnPolysForSnap, drawnCircsForSnap, mapInstance]);

  // `mapInstance` is in the dep array, and that is the whole fix.
  //
  // The manager is created in the effect above, keyed on `mapInstance`, so it
  // can only exist from the commit AFTER `mapInstance` becomes non-null. This
  // effect bailed on `if (!manager) return` during the first commit, and its
  // dep array held only stable references (Zustand actions are fixed members of
  // the created store; `onDrawingComplete` is a `useCallback`), so it NEVER ran
  // again — the manager kept its empty `{}` default callbacks. Polygon, circle
  // and measure all completed into nothing, and `completePolygon()` then
  // `requestAnimationFrame`d `clearDrawingLayers()`, so the shape vanished with
  // no toast and no store write. Drawing a geofence boundary, a survey area, a
  // corridor or a measurement was inert. The two sibling effects above already
  // list `mapInstance` for exactly this reason.
  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    manager.setCallbacks({
      onPolygonComplete: (vertices) => {
        // One undo step reverts the whole draw together with whatever it
        // became (a geofence, a pattern boundary, or a free annotation).
        withPlannerHistory(() => {
          const id = randomId(); const area = polygonArea(vertices);
          const shape: DrawnPolygon = { id, vertices, area };
          addPolygon(shape); onDrawingComplete?.(shape);
        });
        setDrawingMode(null); setActiveTool("select"); setActiveDrawingVertices([]);
      },
      onCircleComplete: (center, radius) => {
        withPlannerHistory(() => {
          const id = randomId(); const shape: DrawnCircle = { id, center, radius };
          addCircle(shape); onDrawingComplete?.(shape);
        });
        setDrawingMode(null); setActiveTool("select"); setActiveDrawingVertices([]);
      },
      onMeasureUpdate: (points, segmentDistances, totalDistance) => { setMeasureLine({ points, segmentDistances, totalDistance }); },
      onVerticesUpdate: (vertices) => { setActiveDrawingVertices(vertices); },
      // Clear the store-backed measure line too, so an explicit cancel (Escape /
      // right-click) never leaves a residual measurement rendered on the map.
      onCancel: () => { setDrawingMode(null); setActiveDrawingVertices([]); setMeasureLine(null); },
    });
  }, [mapInstance, addPolygon, addCircle, setMeasureLine, setDrawingMode, setActiveDrawingVertices, onDrawingComplete]);

  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    if (activeTool === "polygon") { setDrawingMode("polygon"); manager.startPolygonDraw(); }
    else if (activeTool === "circle") { setDrawingMode("circle"); manager.startCircleDraw(); }
    else if (activeTool === "measure") { setDrawingMode("measure"); setMeasureLine(null); manager.startMeasure(); }
    else if (manager.getMode() !== null) { manager.cancelDraw(); setDrawingMode(null); setActiveDrawingVertices([]); }
  }, [mapInstance, activeTool, setDrawingMode, setMeasureLine, setActiveDrawingVertices]);

  useEffect(() => {
    if (!mapInstance) return;
    const clickHandler = (e: L.LeafletMouseEvent) => {
      if (drawingManagerRef.current?.getMode() !== null) return;
      // Forward clicks for placement tools, the explicit datum tool, and select mode.
      if (PLACEMENT_TOOLS.includes(activeTool) || activeTool === "datum" || activeTool === "select") {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    };
    const contextHandler = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      if (DRAWING_TOOLS.includes(activeTool)) {
        const manager = drawingManagerRef.current;
        if (manager && manager.getMode() !== null) {
          if (activeTool === "polygon" && manager.getVertexCount() >= 3) {
            manager.completePolygon();
          } else {
            manager.cancelDraw();
            setDrawingMode(null);
            setActiveDrawingVertices([]);
            setActiveTool("select");
          }
          return;
        }
      }
      const point = mapInstance.latLngToContainerPoint(e.latlng);
      const rect = mapInstance.getContainer().getBoundingClientRect();
      onMapRightClick(e.latlng.lat, e.latlng.lng, rect.left + point.x, rect.top + point.y);
    };
    const reportView = () => {
      const b = mapInstance.getBounds();
      usePlannerStore.getState().setMapView(
        { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        mapInstance.getZoom(),
      );
    };
    const zoomHandler = () => { setZoom(mapInstance.getZoom()); reportView(); };
    const moveHandler = () => {
      const c = mapInstance.getCenter();
      usePlannerStore.getState().setMapCenter([c.lat, c.lng]);
      reportView();
    };
    mapInstance.on("click", clickHandler); mapInstance.on("contextmenu", contextHandler); mapInstance.on("zoomend", zoomHandler); mapInstance.on("moveend", moveHandler);
    moveHandler(); // Set initial center
    return () => { mapInstance.off("click", clickHandler); mapInstance.off("contextmenu", contextHandler); mapInstance.off("zoomend", zoomHandler); mapInstance.off("moveend", moveHandler); };
  }, [mapInstance, activeTool, onMapClick, onMapRightClick, setActiveTool, setDrawingMode, setActiveDrawingVertices]);

  useEffect(() => { if (mapInstance) mapInstance.getContainer().style.cursor = TOOL_CURSORS[activeTool]; }, [mapInstance, activeTool]);

  useEffect(() => {
    if (!mapInstance || fitRequestTs === 0 || waypoints.length === 0) return;
    const bounds = L.latLngBounds(waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]));
    mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 }); clearFitRequest();
  }, [mapInstance, fitRequestTs, waypoints, clearFitRequest]);

  const panRequest = usePlannerStore((s) => s.panRequest);
  const clearPanRequest = usePlannerStore((s) => s.clearPanRequest);
  useEffect(() => {
    if (!mapInstance || !panRequest) return;
    mapInstance.panTo([panRequest.lat, panRequest.lon]);
    clearPanRequest();
  }, [mapInstance, panRequest, clearPanRequest]);

  const polylinePositions = useMemo(
    () => waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]),
    [waypoints]
  );
  const segments = useMemo(() => {
    if (zoom < 14 || waypoints.length < 2) return [];
    return waypoints.slice(1).map((wp, i) => {
      const prev = waypoints[i];
      const dist = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
      const brg = bearing(prev.lat, prev.lon, wp.lat, wp.lon);
      return { key: `seg-${prev.id}-${wp.id}`, position: [(prev.lat + wp.lat) / 2, (prev.lon + wp.lon) / 2] as [number, number], label: `${formatDist(dist)} ${Math.round(brg)}°` };
    });
  }, [waypoints, zoom]);

  // Generate spline curve path if any waypoints are SPLINE_WAYPOINT
  const hasSpline = waypoints.some((wp) => wp.command === "SPLINE_WAYPOINT");
  const splinePositions = useMemo(() => {
    if (!hasSpline || waypoints.length < 2) return [];
    return generateSplinePath(waypoints);
  }, [waypoints, hasSpline]);

  const measurePositions = useMemo(
    () => measureLine?.points.map((p) => [p[0], p[1]] as [number, number]) ?? [],
    [measureLine]
  );

  // Build the waypoint markers once per real change (waypoint set, selection,
  // or drag-ability) instead of on every render. A live telemetry tick re-runs
  // the component but leaves these inputs untouched, so the marker list is
  // returned from the memo unchanged and never rebuilt under the ~10-60 Hz
  // position stream.
  const waypointMarkers = useMemo(
    () =>
      waypoints.map((wp, i) => (
        <Marker key={wp.id} position={[wp.lat, wp.lon]}
          icon={wp.command === "SPLINE_WAYPOINT" ? makeSplineWaypointIcon(i, wp.id === selectedWaypointId) : makeWaypointIcon(i, wp.id === selectedWaypointId)}
          draggable={activeTool === "select"}
          eventHandlers={{
            click: (e) => { e.originalEvent.stopPropagation(); onWaypointClick(wp.id, e.originalEvent.ctrlKey || e.originalEvent.metaKey, e.originalEvent.shiftKey); },
            dragend: (e) => { const ll = e.target.getLatLng(); onWaypointDragEnd(wp.id, ll.lat, ll.lng); },
            contextmenu: (e) => { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); onWaypointRightClick(wp.id, e.originalEvent.clientX, e.originalEvent.clientY); },
          }} />
      )),
    [waypoints, selectedWaypointId, activeTool, onWaypointClick, onWaypointDragEnd, onWaypointRightClick]
  );

  // Rally points are plan-independent (the FC uses them for failsafe): render
  // whenever present and let the operator drag them. A drag is one undo step.
  const rallyMarkers = useMemo(
    () =>
      rallyPoints.map((rp, i) => (
        <Marker key={`rally-${rp.id}`} position={[rp.lat, rp.lon]} icon={makeRallyIcon(i)}
          draggable={activeTool === "select"}
          eventHandlers={{
            dragend: (e) => {
              const ll = e.target.getLatLng();
              useRallyStore.getState().updatePoint(rp.id, { lat: ll.lat, lon: ll.lng });
            },
          }} />
      )),
    [rallyPoints, activeTool],
  );

  const pathStyle = useMemo(
    () => ({ color: MAP_COLORS.accentPrimary, weight: 2, dashArray: "6 4", opacity: hasSpline ? 0.3 : 0.8 }),
    [hasSpline],
  );

  const banner = useMemo(() => mapBannerDescriptor(mode), [mode]);

  return (
    <div className="w-full h-full relative">
      {hasActivePlan && <PlannerGpsBadge />}
      {hasActivePlan && <GuidanceSettingsMenu placement="top-right" />}
      <MapContainer center={defaultCenter} zoom={13} className="w-full h-full bg-bg-primary" zoomControl={false}
        ref={(instance) => { if (instance) setMapInstance(instance); }}>
        <TileLayerSwitcher showControls={hasActivePlan} />
        {hasActivePlan && <CursorTracker />}
        {hasActivePlan && <RasterOverlay />}
        {hasActivePlan && <CoverageOverlay />}
        {hasActivePlan && <KmlOverlayLayers />}
        {/* Straight path (always shown for non-spline or as baseline) */}
        {hasActivePlan && polylinePositions.length >= 2 && <Polyline positions={polylinePositions} pathOptions={pathStyle} />}
        {/* Spline curve overlay (when spline waypoints present) */}
        {hasActivePlan && splinePositions.length >= 2 && <Polyline positions={splinePositions} pathOptions={SPLINE_PATH_STYLE} />}
        {hasActivePlan && segments.map((seg) => <Marker key={seg.key} position={seg.position} icon={makeSegmentLabel(seg.label)} interactive={false} />)}
        {hasActivePlan && <><GcsMarker /><LocateControl /><PatternOverlay /></>}
        {/* Geofence: primary fence (editable) + inclusion/exclusion zones */}
        {hasActivePlan && <><EditableGeofenceOverlay /><GeofenceZonesOverlay /></>}
        {hasActivePlan && <PlannerGuidanceVectors />}
        {hasActivePlan && <JumpArrowOverlay waypoints={waypoints} />}
        {hasActivePlan && waypointMarkers}
        {rallyMarkers}
        <PlanPoiLayer />
        {hasActivePlan && measureLine && measureLine.points.length >= 2 && (<>
          <Polyline positions={measurePositions} pathOptions={MEASURE_PATH_STYLE} />
          {measureLine.points.map((pt, i) => i > 0 ? (
            <Marker key={`meas-seg-${i}`} position={[(pt[0] + measureLine.points[i - 1][0]) / 2, (pt[1] + measureLine.points[i - 1][1]) / 2]}
              icon={makeSegmentLabel(formatDist(measureLine.segmentDistances[i - 1]))} interactive={false} />
          ) : null)}
          <Marker position={measureLine.points[measureLine.points.length - 1]} icon={makeMeasureLabel(`Total: ${formatDist(measureLine.totalDistance)}`)} interactive={false} />
        </>)}
      </MapContainer>

      {/* Fleet map.overlay slot — a GCS-level plugin renders a layer over the
          map (e.g. a heatmap or annotation surface). The wrapper is
          non-interactive; an interactive overlay opts its own elements back
          in. Inert until a plugin contributes. Sits above the Leaflet canvas
          (z below the controls/banner at z-[1000]). */}
      <div
        data-planner-layer="map-overlay"
        className="absolute inset-0 z-[900] pointer-events-none"
      >
        <FleetPluginSlot
          name="map.overlay"
          className="absolute inset-0"
          iframeClassName="absolute inset-0 w-full h-full border-0"
        />
      </div>

      {!hasActivePlan && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center bg-bg-primary/35 backdrop-blur-[1px] pointer-events-none">
          <div className="bg-bg-secondary/90 border border-border-default px-4 py-2 shadow-lg">
            <span className="text-xs text-text-secondary font-mono">Create or select a flight plan to start</span>
          </div>
        </div>
      )}

      {/* One mode-driven hint banner for every interaction mode. The select
          mode keeps a subdued always-on hint that a plain click adds a
          waypoint; every placement / datum / rally / draw mode shows the louder
          accent style. Both are derived from the authoritative `mode` value. */}
      {hasActivePlan && banner && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className={banner.tone === "subdued"
            ? "bg-bg-secondary/90 border border-border-default px-3 py-1.5"
            : "bg-bg-secondary/90 border border-accent-primary/30 px-3 py-1.5"}>
            <span className={banner.tone === "subdued"
              ? "text-xs text-text-secondary font-mono"
              : "text-xs text-accent-primary font-mono"}>{banner.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
