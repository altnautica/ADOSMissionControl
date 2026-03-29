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
import { DrawingManager } from "@/lib/drawing/drawing-manager";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { polygonArea } from "@/lib/drawing/geo-utils";
import { randomId } from "@/lib/utils";
import L from "leaflet";
import {
  makeWaypointIcon, makeSplineWaypointIcon, makeSegmentLabel, makeRallyIcon, makeMeasureLabel, formatDist,
  DRAWING_TOOLS, PLACEMENT_TOOLS, TOOL_CURSORS, TOOL_INSTRUCTIONS,
} from "./planner-map-helpers";
import { generateSplinePath } from "@/lib/spline-interpolation";
import { JumpArrowOverlay } from "./JumpArrowOverlay";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useMissionStore } from "@/stores/mission-store";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayerSwitcher = dynamic(() => import("@/components/map/TileLayerSwitcher").then((m) => ({ default: m.TileLayerSwitcher })), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const GcsMarker = dynamic(() => import("@/components/map/GcsMarker").then((m) => ({ default: m.GcsMarker })), { ssr: false });
const GuidanceSettingsMenu = dynamic(() => import("@/components/shared/GuidanceSettingsMenu").then((m) => ({ default: m.GuidanceSettingsMenu })), { ssr: false });
const PatternOverlay = dynamic(() => import("@/components/planner/PatternOverlay").then((m) => ({ default: m.PatternOverlay })), { ssr: false });
const LocateControl = dynamic(() => import("@/components/map/LocateControl").then((m) => ({ default: m.LocateControl })), { ssr: false });
const KmlOverlayLayers = dynamic(() => import("@/components/planner/KmlOverlayLayers").then((m) => ({ default: m.KmlOverlayLayers })), { ssr: false });

/** Project a lat/lon by distance (m) at a given bearing (deg). */
function projectByBearing(lat: number, lon: number, bearingDeg: number, distanceM: number): [number, number] {
  const R = 6371000;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const dByR = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dByR) +
    Math.cos(lat1) * Math.sin(dByR) * Math.cos(brng),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(dByR) * Math.cos(lat1),
    Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2),
  );

  return [(lat2 * 180) / Math.PI, ((lon2 * 180) / Math.PI + 540) % 360 - 180];
}

/** Convert line type setting to Leaflet dashArray value. */
function getLineTypeDashArray(lineType: "solid" | "dashed" | "dotted"): string | undefined {
  switch (lineType) {
    case "solid":
      return undefined;
    case "dashed":
      return "6 4";
    case "dotted":
      return "2 2";
    default:
      return undefined;
  }
}

interface PlannerMapProps {
  waypoints: Waypoint[];
  activeTool: PlannerTool;
  selectedWaypointId: string | null;
  hasActivePlan: boolean;
  rallyPoints?: RallyPoint[];
  onMapClick: (lat: number, lon: number) => void;
  onMapRightClick: (lat: number, lon: number, x: number, y: number) => void;
  onWaypointClick: (id: string) => void;
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
  const setActiveTool = usePlannerStore((s) => s.setActiveTool);
  const fitRequestTs = usePlannerStore((s) => s.fitRequestTs);
  const clearFitRequest = usePlannerStore((s) => s.clearFitRequest);
  const pos = useTelemetryLatest("position");
  const gps = useTelemetryLatest("gps");
  const nav = useTelemetryLatest("navController");
  const currentWaypoint = useMissionStore((s) => s.currentWaypoint);
  const defaultCenter = useDefaultCenter();
  const isDrawingTool = DRAWING_TOOLS.includes(activeTool);

  // Guidance settings
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

  const dronePos: [number, number] | null =
    pos && pos.lat !== 0 && pos.lon !== 0 ? [pos.lat, pos.lon] : null;

  const gpsFixLabel = useMemo(() => {
    switch (gps?.fixType ?? 0) {
      case 0:
      case 1:
        return "No Fix";
      case 2:
        return "2D Fix";
      case 3:
        return "3D Fix";
      case 4:
        return "DGPS";
      case 5:
        return "RTK Float";
      case 6:
        return "RTK Fixed";
      default:
        return `Fix ${gps?.fixType}`;
    }
  }, [gps]);

  const gpsStatusTone = dronePos
    ? "border-status-success/40 text-status-success"
    : gps?.fixType && gps.fixType >= 2
      ? "border-status-warning/40 text-status-warning"
      : "border-border-default text-text-secondary";

  const gpsStatusLabel = dronePos
    ? "GPS LIVE"
    : gps?.fixType && gps.fixType >= 2
      ? "GETTING POSITION"
      : "ACQUIRING GPS";

  const heading = pos?.heading;

  // 1. CURRENT HEADING (RED/ORANGE) — Drone's physical pointing direction
  // The direction the drone is physically facing (yaw orientation)
  // Based on compass/magnetometer data
  // Shows which way the nose of the aircraft is pointing
  const currentHeadingVector = useMemo(() => {
    if (!dronePos || heading === undefined || !Number.isFinite(heading)) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], heading, guidanceHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, heading, guidanceHdgLength]);

  // 3. TARGET HEADING (GREEN) — Autopilot desired heading
  // The direction the autopilot wants the drone to face
  // May differ from current heading during turns or course corrections
  // In autonomous modes, this aligns with the desired flight path
  const targetHeadingVector = useMemo(() => {
    if (!dronePos || nav?.targetBearing === undefined || !Number.isFinite(nav.targetBearing)) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], nav.targetBearing, guidanceTgtHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, nav, guidanceTgtHdgLength]);

  // 2. DIRECT TO CURRENT WAYPOINT (ORANGE/YELLOW) — Shortest path to active waypoint
  // The direct line/bearing from drone's current position to the active waypoint
  // Shows the shortest path to the next waypoint
  // Helps you see if the drone is on the optimal route
  const wpIndex = currentWaypoint > 0 ? currentWaypoint - 1 : -1;
  const currentWp = wpIndex >= 0 && wpIndex < waypoints.length ? waypoints[wpIndex] : null;
  const trackToWpLine = useMemo(() => {
    if (!dronePos || !currentWp) return null;
    return [dronePos, [currentWp.lat, currentWp.lon] as [number, number]] as [[number, number], [number, number]];
  }, [dronePos, currentWp]);

  useEffect(() => {
    if (!mapInstance) return;
    const manager = new DrawingManager(mapInstance);
    drawingManagerRef.current = manager;
    return () => { manager.destroy(); drawingManagerRef.current = null; };
  }, [mapInstance]);

  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    manager.setCallbacks({
      onPolygonComplete: (vertices) => {
        const id = randomId(); const area = polygonArea(vertices);
        const shape: DrawnPolygon = { id, vertices, area };
        addPolygon(shape); onDrawingComplete?.(shape); setDrawingMode(null); setActiveTool("select"); setActiveDrawingVertices([]);
      },
      onCircleComplete: (center, radius) => {
        const id = randomId(); const shape: DrawnCircle = { id, center, radius };
        addCircle(shape); onDrawingComplete?.(shape); setDrawingMode(null); setActiveTool("select"); setActiveDrawingVertices([]);
      },
      onMeasureUpdate: (points, segmentDistances, totalDistance) => { setMeasureLine({ points, segmentDistances, totalDistance }); },
      onVerticesUpdate: (vertices) => { setActiveDrawingVertices(vertices); },
      onCancel: () => { setDrawingMode(null); setActiveDrawingVertices([]); },
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
      // Pass clicks for placement tools AND select mode (SAR datum placement uses select mode)
      if (PLACEMENT_TOOLS.includes(activeTool) || activeTool === "select") onMapClick(e.latlng.lat, e.latlng.lng);
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
        }
        return;
      }
      const point = mapInstance.latLngToContainerPoint(e.latlng);
      const rect = mapInstance.getContainer().getBoundingClientRect();
      onMapRightClick(e.latlng.lat, e.latlng.lng, rect.left + point.x, rect.top + point.y);
    };
    const zoomHandler = () => setZoom(mapInstance.getZoom());
    const moveHandler = () => {
      const c = mapInstance.getCenter();
      usePlannerStore.getState().setMapCenter([c.lat, c.lng]);
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

  return (
    <div className="w-full h-full relative">
      <div className={`absolute top-3 left-3 z-[1000] rounded border bg-bg-primary/80 px-2 py-1 shadow-lg backdrop-blur-md pointer-events-none ${gpsStatusTone}`}>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="font-semibold">{gpsStatusLabel}</span>
          <span className="text-text-tertiary">|</span>
          <span>{gpsFixLabel}</span>
          <span className="text-text-tertiary">|</span>
          <span>{gps?.satellites ?? 0} sats</span>
        </div>
      </div>

      <MapContainer center={defaultCenter} zoom={13} className="w-full h-full" zoomControl={false} attributionControl={false}
        style={{ background: "#0a0a0a" }} ref={(instance) => { if (instance) setMapInstance(instance); }}>
        <TileLayerSwitcher />
        <KmlOverlayLayers />
        {/* Straight path (always shown for non-spline or as baseline) */}
        {polylinePositions.length >= 2 && <Polyline positions={polylinePositions} pathOptions={{ color: MAP_COLORS.accentPrimary, weight: 2, dashArray: "6 4", opacity: hasSpline ? 0.3 : 0.8 }} />}
        {/* Spline curve overlay (when spline waypoints present) */}
        {splinePositions.length >= 2 && <Polyline positions={splinePositions} pathOptions={{ color: "#00e5ff", weight: 2.5, opacity: 0.9 }} />}
        {segments.map((seg) => <Marker key={seg.key} position={seg.position} icon={makeSegmentLabel(seg.label)} interactive={false} />)}
        <GcsMarker /><LocateControl /><PatternOverlay />
        <JumpArrowOverlay waypoints={waypoints} />

        {/* Guidance vectors: heading, track to active WP, and target heading */}
        {currentHeadingVector && (
          <Polyline
            positions={currentHeadingVector}
            pathOptions={{
              color: guidanceHdgColor,
              weight: guidanceHdgWidth,
              opacity: 0.9,
              dashArray: getLineTypeDashArray(guidanceHdgLineType),
            }}
          />
        )}
        {trackToWpLine && (
          <Polyline
            positions={trackToWpLine}
            pathOptions={{
              color: guidanceTrackWpColor,
              weight: guidanceTrackWpWidth,
              opacity: 0.85,
              dashArray: getLineTypeDashArray(guidanceTrackWpLineType),
            }}
          />
        )}
        {targetHeadingVector && (
          <Polyline
            positions={targetHeadingVector}
            pathOptions={{
              color: guidanceTgtHdgColor,
              weight: guidanceTgtHdgWidth,
              opacity: 0.9,
              dashArray: getLineTypeDashArray(guidanceTgtHdgLineType),
            }}
          />
        )}

        {waypoints.map((wp, i) => (
          <Marker key={wp.id} position={[wp.lat, wp.lon]}
            icon={wp.command === "SPLINE_WAYPOINT" ? makeSplineWaypointIcon(i, wp.id === selectedWaypointId) : makeWaypointIcon(i, wp.id === selectedWaypointId)}
            draggable={activeTool === "select"}
            eventHandlers={{
              click: (e) => { e.originalEvent.stopPropagation(); onWaypointClick(wp.id); },
              dragend: (e) => { const ll = e.target.getLatLng(); onWaypointDragEnd(wp.id, ll.lat, ll.lng); },
              contextmenu: (e) => { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); onWaypointRightClick(wp.id, e.originalEvent.clientX, e.originalEvent.clientY); },
            }} />
        ))}
        {rallyPoints.map((rp, i) => <Marker key={`rally-${rp.id}`} position={[rp.lat, rp.lon]} icon={makeRallyIcon(i)} interactive={false} />)}
        {measureLine && measureLine.points.length >= 2 && (<>
          <Polyline positions={measurePositions} pathOptions={{ color: MAP_COLORS.muted, weight: 2, dashArray: "4 4" }} />
          {measureLine.points.map((pt, i) => i > 0 ? (
            <Marker key={`meas-seg-${i}`} position={[(pt[0] + measureLine.points[i - 1][0]) / 2, (pt[1] + measureLine.points[i - 1][1]) / 2]}
              icon={makeSegmentLabel(formatDist(measureLine.segmentDistances[i - 1]))} interactive={false} />
          ) : null)}
          <Marker position={measureLine.points[measureLine.points.length - 1]} icon={makeMeasureLabel(`Total: ${formatDist(measureLine.totalDistance)}`)} interactive={false} />
        </>)}
      </MapContainer>

      {TOOL_INSTRUCTIONS[activeTool] && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-bg-secondary/90 border border-accent-primary/30 px-3 py-1.5">
            <span className="text-xs text-accent-primary font-mono">{TOOL_INSTRUCTIONS[activeTool]}</span>
          </div>
        </div>
      )}
      {waypoints.length === 0 && !isDrawingTool && !TOOL_INSTRUCTIONS[activeTool] && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-bg-secondary/90 border border-border-default px-3 py-1.5">
            <span className="text-xs text-text-secondary font-mono">{hasActivePlan ? "Click on map to add waypoints" : "Create or select a flight plan to start"}</span>
          </div>
        </div>
      )}

      {/* Guidance vectors legend with settings menu */}
      <GuidanceSettingsMenu />
      {isDrawingTool && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-bg-secondary/90 border border-accent-primary/30 px-3 py-1.5">
            <span className="text-xs text-accent-primary font-mono">
              {activeTool === "polygon" && "Click to place vertices. Right-click or click first vertex to close. Backspace to undo. Escape to cancel."}
              {activeTool === "circle" && "Click and drag to draw circle. Right-click to cancel."}
              {activeTool === "measure" && "Click to add points, double-click to finish. Right-click to cancel."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
