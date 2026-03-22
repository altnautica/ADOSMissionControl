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
import { polygonArea } from "@/lib/drawing/geo-utils";
import { randomId } from "@/lib/utils";
import L from "leaflet";
import {
  makeWaypointIcon, makeSegmentLabel, makeRallyIcon, makeMeasureLabel, formatDist,
  DRAWING_TOOLS, PLACEMENT_TOOLS, TOOL_CURSORS, TOOL_INSTRUCTIONS,
} from "./planner-map-helpers";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayerSwitcher = dynamic(() => import("@/components/map/TileLayerSwitcher").then((m) => ({ default: m.TileLayerSwitcher })), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const GcsMarker = dynamic(() => import("@/components/map/GcsMarker").then((m) => ({ default: m.GcsMarker })), { ssr: false });
const PatternOverlay = dynamic(() => import("@/components/planner/PatternOverlay").then((m) => ({ default: m.PatternOverlay })), { ssr: false });
const LocateControl = dynamic(() => import("@/components/map/LocateControl").then((m) => ({ default: m.LocateControl })), { ssr: false });

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
  const defaultCenter = useDefaultCenter();
  const isDrawingTool = DRAWING_TOOLS.includes(activeTool);

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
    const clickHandler = (e: L.LeafletMouseEvent) => { if (PLACEMENT_TOOLS.includes(activeTool)) onMapClick(e.latlng.lat, e.latlng.lng); };
    const contextHandler = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      if (DRAWING_TOOLS.includes(activeTool)) {
        const manager = drawingManagerRef.current;
        if (manager && manager.getMode() !== null) { manager.cancelDraw(); setDrawingMode(null); setActiveDrawingVertices([]); }
        setActiveTool("select"); return;
      }
      const point = mapInstance.latLngToContainerPoint(e.latlng);
      const rect = mapInstance.getContainer().getBoundingClientRect();
      onMapRightClick(e.latlng.lat, e.latlng.lng, rect.left + point.x, rect.top + point.y);
    };
    const zoomHandler = () => setZoom(mapInstance.getZoom());
    mapInstance.on("click", clickHandler); mapInstance.on("contextmenu", contextHandler); mapInstance.on("zoomend", zoomHandler);
    return () => { mapInstance.off("click", clickHandler); mapInstance.off("contextmenu", contextHandler); mapInstance.off("zoomend", zoomHandler); };
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

  const measurePositions = useMemo(
    () => measureLine?.points.map((p) => [p[0], p[1]] as [number, number]) ?? [],
    [measureLine]
  );

  return (
    <div className="w-full h-full relative">
      <MapContainer center={defaultCenter} zoom={13} className="w-full h-full" zoomControl={false} attributionControl={false}
        style={{ background: "#0a0a0a" }} ref={(instance) => { if (instance) setMapInstance(instance); }}>
        <TileLayerSwitcher />
        {polylinePositions.length >= 2 && <Polyline positions={polylinePositions} pathOptions={{ color: MAP_COLORS.accentPrimary, weight: 2, dashArray: "6 4", opacity: 0.8 }} />}
        {segments.map((seg) => <Marker key={seg.key} position={seg.position} icon={makeSegmentLabel(seg.label)} interactive={false} />)}
        <GcsMarker /><LocateControl /><PatternOverlay />
        {waypoints.map((wp, i) => (
          <Marker key={wp.id} position={[wp.lat, wp.lon]} icon={makeWaypointIcon(i, wp.id === selectedWaypointId)} draggable={activeTool === "select"}
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
      {isDrawingTool && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-bg-secondary/90 border border-accent-primary/30 px-3 py-1.5">
            <span className="text-xs text-accent-primary font-mono">
              {activeTool === "polygon" && "Click to place vertices, double-click to close. Right-click to cancel."}
              {activeTool === "circle" && "Click and drag to draw circle. Right-click to cancel."}
              {activeTool === "measure" && "Click to add points, double-click to finish. Right-click to cancel."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
