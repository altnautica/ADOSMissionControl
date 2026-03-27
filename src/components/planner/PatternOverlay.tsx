/**
 * @module PatternOverlay
 * @description Renders flight pattern preview on the Leaflet map.
 * Shows survey polygon boundary, orbit circle, corridor boundary,
 * transect preview lines, and camera capture points.
 * Must be rendered inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { MAP_COLORS, withAlpha } from "@/lib/map-constants";
import L from "leaflet";

const Polyline = dynamic(
  () => import("react-leaflet").then((m) => m.Polyline),
  { ssr: false }
);
const Polygon = dynamic(
  () => import("react-leaflet").then((m) => m.Polygon),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker),
  { ssr: false }
);
const LeafletCircle = dynamic(
  () => import("react-leaflet").then((m) => m.Circle),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);

const FENCE_COLOR = MAP_COLORS.fence;
const PATTERN_COLOR = MAP_COLORS.accentPrimary;
const TRANSECT_COLOR = withAlpha(MAP_COLORS.accentPrimary, 0.4);
const CAPTURE_DOT_COLOR = MAP_COLORS.accentSelected;
const DATUM_COLOR = MAP_COLORS.rally;

function makeAreaLabel(text: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [120, 20],
    iconAnchor: [60, 10],
    html: `<div style="font-size:10px;font-family:JetBrains Mono,monospace;color:${MAP_COLORS.accentPrimary};white-space:nowrap;text-align:center;background:${withAlpha(MAP_COLORS.background, 0.8)};padding:2px 6px;border:1px solid ${withAlpha(MAP_COLORS.accentPrimary, 0.3)}">${text}</div>`,
  });
}

export function PatternOverlay() {
  const activeType = usePatternStore((s) => s.activePatternType);
  const patternResult = usePatternStore((s) => s.patternResult);
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const sarExpandingSquareConfig = usePatternStore((s) => s.sarExpandingSquareConfig);
  const sarSectorSearchConfig = usePatternStore((s) => s.sarSectorSearchConfig);
  const sarParallelTrackConfig = usePatternStore((s) => s.sarParallelTrackConfig);

  // Drawn shapes for boundary display
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  const drawnCircles = useDrawingStore((s) => s.circles);
  const selectedPolygonIds = useDrawingStore((s) => s.selectedPolygonIds);

  // Geofence overlay
  const fenceEnabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const fencePolygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const fenceCircleCenter = useGeofenceStore((s) => s.circleCenter);
  const fenceCircleRadius = useGeofenceStore((s) => s.circleRadius);

  // Pattern waypoint positions for flight path preview
  const patternPath = useMemo(() => {
    if (!patternResult) return [];
    return patternResult.waypoints
      .filter((wp) => wp.command === "WAYPOINT" || wp.command === "SPLINE_WAYPOINT")
      .map((wp) => [wp.lat, wp.lon] as [number, number]);
  }, [patternResult]);

  // Camera capture positions (from DO_SET_CAM_TRIGG waypoints or generated trigger points)
  const capturePoints = useMemo(() => {
    if (!patternResult) return [];
    return patternResult.waypoints
      .filter((wp) => wp.command === "DO_SET_CAM_TRIGG" || wp.command === "DO_DIGICAM")
      .map((wp) => [wp.lat, wp.lon] as [number, number]);
  }, [patternResult]);

  // Survey polygon boundary
  const surveyBoundary = useMemo(() => {
    if (activeType === "survey" && surveyConfig.polygon) {
      return surveyConfig.polygon;
    }
    if (activeType === "survey" && drawnPolygons.length > 0) {
      return drawnPolygons[drawnPolygons.length - 1].vertices;
    }
    return null;
  }, [activeType, surveyConfig.polygon, drawnPolygons]);

  // SAR datum / start point for map marker
  const datumPoint = useMemo((): [number, number] | null => {
    if (activeType === "expandingSquare" && sarExpandingSquareConfig.center) {
      return sarExpandingSquareConfig.center as [number, number];
    }
    if (activeType === "sectorSearch" && sarSectorSearchConfig.center) {
      return sarSectorSearchConfig.center as [number, number];
    }
    if (activeType === "parallelTrack" && sarParallelTrackConfig.startPoint) {
      return sarParallelTrackConfig.startPoint as [number, number];
    }
    return null;
  }, [activeType, sarExpandingSquareConfig.center, sarSectorSearchConfig.center, sarParallelTrackConfig.startPoint]);

  // Corridor path centerline
  const corridorPath = useMemo((): [number, number][] | null => {
    if (activeType === "corridor" && corridorConfig.pathPoints && corridorConfig.pathPoints.length >= 2) {
      return corridorConfig.pathPoints as [number, number][];
    }
    return null;
  }, [activeType, corridorConfig.pathPoints]);

  return (
    <>
      {/* ── Drawn Polygon boundaries ──────────────────────────── */}
      {drawnPolygons.map((poly) => {
        const isSelected = selectedPolygonIds.includes(poly.id);
        return (
          <Polygon
            key={poly.id}
            positions={poly.vertices.map((v) => [v[0], v[1]] as [number, number])}
            pathOptions={{
              color: PATTERN_COLOR,
              weight: 2,
              fillColor: withAlpha(MAP_COLORS.accentPrimary, isSelected ? 0.15 : 0.05),
              fillOpacity: 1,
              ...(isSelected ? {} : { dashArray: "4 4" }),
            }}
          />
        );
      })}

      {/* ── Drawn Circle boundaries ──────────────────────────── */}
      {drawnCircles.map((circ) => (
        <LeafletCircle
          key={circ.id}
          center={[circ.center[0], circ.center[1]]}
          radius={circ.radius}
          pathOptions={{
            color: PATTERN_COLOR,
            weight: 2,
            fillColor: withAlpha(MAP_COLORS.accentPrimary, 0.15),
            fillOpacity: 1,
          }}
        />
      ))}

      {/* ── Survey boundary overlay ──────────────────────────── */}
      {surveyBoundary && activeType === "survey" && (
        <Polygon
          positions={surveyBoundary.map((v) => [v[0], v[1]] as [number, number])}
          pathOptions={{
            color: PATTERN_COLOR,
            weight: 2,
            fillColor: withAlpha(MAP_COLORS.accentPrimary, 0.08),
            fillOpacity: 1,
          }}
        />
      )}

      {/* ── Orbit circle overlay ─────────────────────────────── */}
      {activeType === "orbit" && orbitConfig.center && (
        <LeafletCircle
          center={[orbitConfig.center[0], orbitConfig.center[1]]}
          radius={orbitConfig.radius ?? 50}
          pathOptions={{
            color: PATTERN_COLOR,
            weight: 2,
            fillColor: withAlpha(MAP_COLORS.accentPrimary, 0.08),
            fillOpacity: 1,
          }}
        />
      )}

      {/* ── Transect preview lines ──────────────────────────── */}
      {patternResult?.previewLines?.map((line, i) => (
        <Polyline
          key={`transect-${i}`}
          positions={line.map((p) => [p[0], p[1]] as [number, number])}
          pathOptions={{
            color: TRANSECT_COLOR,
            weight: 1,
            dashArray: "3 3",
          }}
        />
      ))}

      {/* ── Pattern flight path ─────────────────────────────── */}
      {patternPath.length >= 2 && (
        <Polyline
          positions={patternPath}
          pathOptions={{
            color: PATTERN_COLOR,
            weight: 2,
            opacity: 0.8,
          }}
        />
      )}

      {/* ── Camera capture points ──────────────────────────── */}
      {capturePoints.map((pt, i) => (
        <CircleMarker
          key={`cap-${i}`}
          center={[pt[0], pt[1]]}
          radius={2}
          pathOptions={{
            color: CAPTURE_DOT_COLOR,
            fillColor: CAPTURE_DOT_COLOR,
            fillOpacity: 0.8,
            weight: 0,
          }}
        />
      ))}

      {/* ── SAR datum / start point marker ──────────────────── */}
      {datumPoint && (
        <CircleMarker
          center={[datumPoint[0], datumPoint[1]]}
          radius={6}
          pathOptions={{
            color: DATUM_COLOR,
            fillColor: DATUM_COLOR,
            fillOpacity: 0.9,
            weight: 2,
          }}
        />
      )}

      {/* ── Corridor path centerline ─────────────────────────── */}
      {corridorPath && corridorPath.length >= 2 && (
        <Polyline
          positions={corridorPath}
          pathOptions={{
            color: PATTERN_COLOR,
            weight: 2,
            dashArray: "6 4",
            opacity: 0.7,
          }}
        />
      )}

      {/* ── Geofence overlay ────────────────────────────────── */}
      {fenceEnabled && fenceType === "polygon" && fencePolygonPoints.length >= 3 && (
        <Polygon
          positions={fencePolygonPoints.map((p) => [p[0], p[1]] as [number, number])}
          pathOptions={{
            color: FENCE_COLOR,
            weight: 2,
            dashArray: "8 4",
            fillColor: withAlpha(MAP_COLORS.fence, 0.05),
            fillOpacity: 1,
          }}
        />
      )}
      {fenceEnabled && fenceType === "circle" && fenceCircleCenter && (
        <LeafletCircle
          center={[fenceCircleCenter[0], fenceCircleCenter[1]]}
          radius={fenceCircleRadius}
          pathOptions={{
            color: FENCE_COLOR,
            weight: 2,
            dashArray: "8 4",
            fillColor: withAlpha(MAP_COLORS.fence, 0.05),
            fillOpacity: 1,
          }}
        />
      )}
    </>
  );
}
