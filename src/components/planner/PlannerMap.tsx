/**
 * @module PlannerMap
 * @description Leaflet-based mission planner map component. Renders waypoint markers
 * (draggable in select mode), path polyline, segment distance/bearing labels,
 * drawing overlays (polygon, circle, measure), and handles click/right-click/drag events.
 * Uses dark CARTO tiles.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { Waypoint, PlannerTool } from "@/lib/types";
import type { RallyPoint } from "@/stores/rally-store";
import type { DrawnPolygon, DrawnCircle } from "@/lib/drawing/types";
import { haversineDistance, bearing } from "@/lib/telemetry-utils";
import { MAP_COLORS } from "@/lib/map-constants";
import { useDefaultCenter } from "@/hooks/use-default-center";
import { DrawingManager, registerActiveDrawApi } from "@/lib/drawing/drawing-manager";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useRallyStore } from "@/stores/rally-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { polygonArea, projectByBearing, getLineTypeDashArray, GPS_FIX_LABELS } from "@/lib/drawing/geo-utils";
import { randomId } from "@/lib/utils";
import L from "leaflet";
import {
  makeWaypointIcon, makeSplineWaypointIcon, makeSegmentLabel, makeRallyIcon, makeMeasureLabel, formatDist,
  DRAWING_TOOLS, PLACEMENT_TOOLS, TOOL_CURSORS,
} from "./planner-map-helpers";
import { generateSplinePath } from "@/lib/spline-interpolation";
import { recordHistory } from "@/lib/planner-history";
import { JumpArrowOverlay } from "./JumpArrowOverlay";
import { FleetPluginSlot } from "@/components/plugins/FleetPluginSlot";
import type { PlannerMode } from "@/lib/planner-mode";
import { datumPatternFor } from "@/lib/planner-mode";
import { useMapEvents } from "react-leaflet";
import { CURSOR_MOVE_EVENT } from "@/lib/planner/cursor-coord";

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

/**
 * A single in-map hint surface. `tone` controls whether the banner reads as the
 * always-on subdued select hint or the louder accent hint shown while an
 * explicit placement / drawing mode is armed.
 */
interface BannerDescriptor {
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
 * select mode keeps a subdued always-on hint). Exported for unit testing.
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

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayerSwitcher = dynamic(() => import("@/components/map/TileLayerSwitcher").then((m) => ({ default: m.TileLayerSwitcher })), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const GcsMarker = dynamic(() => import("@/components/map/GcsMarker").then((m) => ({ default: m.GcsMarker })), { ssr: false });
const PatternOverlay = dynamic(() => import("@/components/planner/PatternOverlay").then((m) => ({ default: m.PatternOverlay })), { ssr: false });
const LocateControl = dynamic(() => import("@/components/map/LocateControl").then((m) => ({ default: m.LocateControl })), { ssr: false });
const KmlOverlayLayers = dynamic(() => import("@/components/planner/KmlOverlayLayers").then((m) => ({ default: m.KmlOverlayLayers })), { ssr: false });
const RasterOverlay = dynamic(() => import("@/components/planner/RasterOverlay").then((m) => ({ default: m.RasterOverlay })), { ssr: false });
const CoverageOverlay = dynamic(() => import("@/components/planner/CoverageOverlay").then((m) => ({ default: m.CoverageOverlay })), { ssr: false });
const GuidanceSettingsMenu = dynamic(() => import("@/components/shared/GuidanceSettingsMenu").then((m) => ({ default: m.GuidanceSettingsMenu })), { ssr: false });
const EditableGeofenceOverlay = dynamic(() => import("@/components/map/EditableGeofenceOverlay").then((m) => ({ default: m.EditableGeofenceOverlay })), { ssr: false });
const PlanPoiLayer = dynamic(() => import("@/components/planner/PlanPoiLayer").then((m) => ({ default: m.PlanPoiLayer })), { ssr: false });
const GeofenceZonesOverlay = dynamic(() => import("@/components/map/GeofenceOverlay").then((m) => ({ default: m.GeofenceZonesOverlay })), { ssr: false });


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

  // Telemetry for GPS badge + guidance vectors
  const pos = useTelemetryLatest("position");
  const gps = useTelemetryLatest("gps");
  const nav = useTelemetryLatest("navController");
  // `useTelemetryLatest` re-runs every ~10-60 Hz telemetry tick, so reading the
  // raw lat/lon directly here is fine, but a fresh `[lat, lon]` array literal
  // would change reference on every tick and force the guidance-vector memos
  // (and any other consumer) to recompute even when the position is unchanged.
  // Pull the primitive values out first, then memoize the array on those exact
  // numbers so a tick that does not move the drone produces a stable reference.
  const posLat = pos?.lat ?? null;
  const posLon = pos?.lon ?? null;
  const heading = pos?.heading ?? 0;
  const hasPos = pos != null;
  const dronePos = useMemo<[number, number] | null>(
    () =>
      posLat !== null && posLon !== null && posLat !== 0 && posLon !== 0
        ? [posLat, posLon]
        : null,
    [posLat, posLon],
  );
  // Absent until a GPS message arrives. Defaulting to fix 0 / 0 satellites
  // renders a red "NO FIX | 0 SAT", which asserts the receiver has failed to
  // lock. Having received no fix report is not the same claim, so the badge
  // reads unknown until there is something to report.
  const fixType = gps?.fixType;
  const satellites = gps?.satellites;
  const fixLabel =
    fixType != null ? (GPS_FIX_LABELS[fixType] ?? `FIX ${fixType}`) : "GPS --";

  // Guidance line settings
  const guidanceHdgLength = useSettingsStore((s) => s.guidanceHdgLength);
  const guidanceHdgWidth = useSettingsStore((s) => s.guidanceHdgWidth);
  const guidanceHdgLineType = useSettingsStore((s) => s.guidanceHdgLineType);
  const guidanceHdgColor = useSettingsStore((s) => s.guidanceHdgColor);
  const guidanceTrackWpLength = useSettingsStore((s) => s.guidanceTrackWpLength);
  const guidanceTrackWpWidth = useSettingsStore((s) => s.guidanceTrackWpWidth);
  const guidanceTrackWpLineType = useSettingsStore((s) => s.guidanceTrackWpLineType);
  const guidanceTrackWpColor = useSettingsStore((s) => s.guidanceTrackWpColor);
  const guidanceTgtHdgLength = useSettingsStore((s) => s.guidanceTgtHdgLength);
  const guidanceTgtHdgWidth = useSettingsStore((s) => s.guidanceTgtHdgWidth);
  const guidanceTgtHdgLineType = useSettingsStore((s) => s.guidanceTgtHdgLineType);
  const guidanceTgtHdgColor = useSettingsStore((s) => s.guidanceTgtHdgColor);
  const guidanceHdgEnabled = useSettingsStore((s) => s.guidanceHdgEnabled);
  const guidanceTrackWpEnabled = useSettingsStore((s) => s.guidanceTrackWpEnabled);
  const guidanceTgtHdgEnabled = useSettingsStore((s) => s.guidanceTgtHdgEnabled);

  // Guidance vector endpoints
  const hdgLine = useMemo(() => {
    if (!dronePos || (heading === 0 && !hasPos)) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], heading, guidanceHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, heading, guidanceHdgLength, hasPos]);

  const trackWpLine = useMemo(() => {
    if (!dronePos || !nav) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], nav.targetBearing, guidanceTrackWpLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, nav, guidanceTrackWpLength]);

  const tgtHdgLine = useMemo(() => {
    if (!dronePos || !nav) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], nav.navBearing, guidanceTgtHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, nav, guidanceTgtHdgLength]);

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

  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    manager.setCallbacks({
      onPolygonComplete: (vertices) => {
        // Record the pre-draw combined planner state first, so a single undo
        // reverts the whole draw together with whatever it became (a geofence,
        // a pattern boundary, or a free annotation) in one step.
        recordHistory();
        const id = randomId(); const area = polygonArea(vertices);
        const shape: DrawnPolygon = { id, vertices, area };
        addPolygon(shape); onDrawingComplete?.(shape); setDrawingMode(null); setActiveTool("select"); setActiveDrawingVertices([]);
      },
      onCircleComplete: (center, radius) => {
        recordHistory();
        const id = randomId(); const shape: DrawnCircle = { id, center, radius };
        addCircle(shape); onDrawingComplete?.(shape); setDrawingMode(null); setActiveTool("select"); setActiveDrawingVertices([]);
      },
      onMeasureUpdate: (points, segmentDistances, totalDistance) => { setMeasureLine({ points, segmentDistances, totalDistance }); },
      onVerticesUpdate: (vertices) => { setActiveDrawingVertices(vertices); },
      // Clear the store-backed measure line too, so an explicit cancel (Escape /
      // right-click) never leaves a residual measurement rendered on the map.
      onCancel: () => { setDrawingMode(null); setActiveDrawingVertices([]); setMeasureLine(null); },
    });
  }, [addPolygon, addCircle, setMeasureLine, setDrawingMode, setActiveDrawingVertices, onDrawingComplete]);

  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    if (activeTool === "polygon") { setDrawingMode("polygon"); manager.startPolygonDraw(); }
    else if (activeTool === "circle") { setDrawingMode("circle"); manager.startCircleDraw(); }
    else if (activeTool === "measure") { setDrawingMode("measure"); setMeasureLine(null); manager.startMeasure(); }
    else if (manager.getMode() !== null) { manager.cancelDraw(); setDrawingMode(null); setActiveDrawingVertices([]); }
  }, [activeTool, setDrawingMode, setMeasureLine, setActiveDrawingVertices]);

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

  const banner = useMemo(() => mapBannerDescriptor(mode), [mode]);

  return (
    <div className="w-full h-full relative">
      {/* GPS status badge */}
      {hasActivePlan && (
        <span className={`absolute top-2 left-2 z-[1000] text-[10px] font-mono bg-bg-primary/80 backdrop-blur-md rounded px-1.5 py-0.5 border border-border-strong shadow-lg ${fixType == null ? "text-text-tertiary" : fixType >= 3 ? "text-status-success" : fixType >= 2 ? "text-status-warning" : "text-status-error"}`}>
          {fixLabel} | {satellites ?? "--"} SAT
        </span>
      )}
      {hasActivePlan && <GuidanceSettingsMenu placement="top-right" />}
      <MapContainer center={defaultCenter} zoom={13} className="w-full h-full" zoomControl={false} attributionControl={false}
        style={{ background: "#0a0a0a" }} ref={(instance) => { if (instance) setMapInstance(instance); }}>
        <TileLayerSwitcher showControls={hasActivePlan} />
        {hasActivePlan && <CursorTracker />}
        {hasActivePlan && <RasterOverlay />}
        {hasActivePlan && <CoverageOverlay />}
        {hasActivePlan && <KmlOverlayLayers />}
        {/* Straight path (always shown for non-spline or as baseline) */}
        {hasActivePlan && polylinePositions.length >= 2 && <Polyline positions={polylinePositions} pathOptions={{ color: MAP_COLORS.accentPrimary, weight: 2, dashArray: "6 4", opacity: hasSpline ? 0.3 : 0.8 }} />}
        {/* Spline curve overlay (when spline waypoints present) */}
        {hasActivePlan && splinePositions.length >= 2 && <Polyline positions={splinePositions} pathOptions={{ color: "#00e5ff", weight: 2.5, opacity: 0.9 }} />}
        {hasActivePlan && segments.map((seg) => <Marker key={seg.key} position={seg.position} icon={makeSegmentLabel(seg.label)} interactive={false} />)}
        {hasActivePlan && <><GcsMarker /><LocateControl /><PatternOverlay /></>}
        {/* Geofence: primary fence (editable) + inclusion/exclusion zones */}
        {hasActivePlan && <><EditableGeofenceOverlay /><GeofenceZonesOverlay /></>}
        {/* Guidance vector polylines */}
        {hasActivePlan && guidanceHdgEnabled && hdgLine && (
          <Polyline positions={hdgLine} pathOptions={{ color: guidanceHdgColor, weight: guidanceHdgWidth, dashArray: getLineTypeDashArray(guidanceHdgLineType), opacity: 0.8 }} />
        )}
        {hasActivePlan && guidanceTrackWpEnabled && trackWpLine && (
          <Polyline positions={trackWpLine} pathOptions={{ color: guidanceTrackWpColor, weight: guidanceTrackWpWidth, dashArray: getLineTypeDashArray(guidanceTrackWpLineType), opacity: 0.8 }} />
        )}
        {hasActivePlan && guidanceTgtHdgEnabled && tgtHdgLine && (
          <Polyline positions={tgtHdgLine} pathOptions={{ color: guidanceTgtHdgColor, weight: guidanceTgtHdgWidth, dashArray: getLineTypeDashArray(guidanceTgtHdgLineType), opacity: 0.8 }} />
        )}
        {hasActivePlan && <JumpArrowOverlay waypoints={waypoints} />}
        {hasActivePlan && waypointMarkers}
        {/* Rally points are plan-independent (the FC uses them for failsafe) — render
            whenever present, and let the operator drag them to reposition. */}
        {rallyPoints.map((rp, i) => (
          <Marker key={`rally-${rp.id}`} position={[rp.lat, rp.lon]} icon={makeRallyIcon(i)}
            draggable={activeTool === "select"}
            eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); useRallyStore.getState().updatePoint(rp.id, { lat: ll.lat, lon: ll.lng }); } }} />
        ))}
        <PlanPoiLayer />
        {hasActivePlan && measureLine && measureLine.points.length >= 2 && (<>
          <Polyline positions={measurePositions} pathOptions={{ color: MAP_COLORS.muted, weight: 2, dashArray: "4 4" }} />
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
