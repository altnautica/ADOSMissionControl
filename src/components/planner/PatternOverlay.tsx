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
import { usePatternStore, parallelTrackRect, expandingSquareReach } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { MAP_COLORS, withAlpha } from "@/lib/map-constants";

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

const FENCE_COLOR = MAP_COLORS.fence;
const PATTERN_COLOR = MAP_COLORS.accentPrimary;
const TRANSECT_COLOR = withAlpha(MAP_COLORS.accentPrimary, 0.4);
const CAPTURE_DOT_COLOR = MAP_COLORS.accentSelected;
const DATUM_COLOR = MAP_COLORS.rally;
const LANDING_COLOR = MAP_COLORS.accentSelected;

// Faint coverage-extent preview shown while a SAR pattern is being configured.
const SAR_PREVIEW_OPTS = {
  color: PATTERN_COLOR,
  weight: 1.5,
  dashArray: "4 4",
  fillColor: withAlpha(MAP_COLORS.accentPrimary, 0.05),
  fillOpacity: 1,
} as const;

// Inert outline of the last-applied pattern's input area (no active pattern).
const APPLIED_FILL_OPTS = {
  color: PATTERN_COLOR,
  weight: 1.5,
  opacity: 0.35,
  dashArray: "2 6",
  fillColor: withAlpha(MAP_COLORS.accentPrimary, 0.03),
  fillOpacity: 1,
} as const;
const APPLIED_LINE_OPTS = {
  color: PATTERN_COLOR,
  weight: 1.5,
  opacity: 0.35,
  dashArray: "2 6",
} as const;
const APPLIED_POINT_OPTS = {
  color: PATTERN_COLOR,
  weight: 1.5,
  opacity: 0.4,
  dashArray: "2 4",
  fillColor: PATTERN_COLOR,
  fillOpacity: 0.2,
} as const;

export function PatternOverlay() {
  const activeType = usePatternStore((s) => s.activePatternType);
  const patternResult = usePatternStore((s) => s.patternResult);
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const structureScanConfig = usePatternStore((s) => s.structureScanConfig);
  const sarExpandingSquareConfig = usePatternStore((s) => s.sarExpandingSquareConfig);
  const sarSectorSearchConfig = usePatternStore((s) => s.sarSectorSearchConfig);
  const sarParallelTrackConfig = usePatternStore((s) => s.sarParallelTrackConfig);
  const fixedWingLandingConfig = usePatternStore((s) => s.fixedWingLandingConfig);
  const vtolLandingConfig = usePatternStore((s) => s.vtolLandingConfig);
  const appliedBoundary = usePatternStore((s) => s.appliedBoundary);

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

  // Structure-scan boundary. The scanned structure's footprint renders from the
  // stored config so the boundary persists after the raw drawn polygon is
  // dropped (the config polygon and the drawn shape are otherwise the same ring
  // painted twice), with a fallback to the last drawn polygon before a config
  // is captured.
  const structureBoundary = useMemo(() => {
    if (activeType !== "structureScan") return null;
    if (structureScanConfig.structurePolygon && structureScanConfig.structurePolygon.length >= 3) {
      return structureScanConfig.structurePolygon;
    }
    if (drawnPolygons.length > 0) {
      return drawnPolygons[drawnPolygons.length - 1].vertices;
    }
    return null;
  }, [activeType, structureScanConfig.structurePolygon, drawnPolygons]);

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

  // Expanding-square coverage ring — approximate outward reach from the datum.
  const expandingSquareRing = useMemo((): { center: [number, number]; radius: number } | null => {
    if (activeType !== "expandingSquare" || !sarExpandingSquareConfig.center) return null;
    return {
      center: sarExpandingSquareConfig.center as [number, number],
      radius: expandingSquareReach(sarExpandingSquareConfig),
    };
  }, [activeType, sarExpandingSquareConfig]);

  // Sector-search coverage ring — the search radius from the datum.
  const sectorSearchRing = useMemo((): { center: [number, number]; radius: number } | null => {
    if (activeType !== "sectorSearch" || !sarSectorSearchConfig.center) return null;
    return {
      center: sarSectorSearchConfig.center as [number, number],
      radius: sarSectorSearchConfig.radius ?? 200,
    };
  }, [activeType, sarSectorSearchConfig.center, sarSectorSearchConfig.radius]);

  // Parallel-track coverage rectangle from the start point + track geometry.
  const parallelTrackBoundary = useMemo((): [number, number][] | null => {
    if (activeType !== "parallelTrack") return null;
    return parallelTrackRect(sarParallelTrackConfig);
  }, [activeType, sarParallelTrackConfig]);

  // Landing point marker — shown as soon as the landing point is set.
  const landingMarker = useMemo((): [number, number] | null => {
    if (activeType === "fixedWingLanding" && fixedWingLandingConfig.landingPoint) {
      return fixedWingLandingConfig.landingPoint as [number, number];
    }
    if (activeType === "vtolLanding" && vtolLandingConfig.landingPoint) {
      return vtolLandingConfig.landingPoint as [number, number];
    }
    return null;
  }, [activeType, fixedWingLandingConfig.landingPoint, vtolLandingConfig.landingPoint]);

  // Landing approach path — the generated approach -> descent -> land waypoints,
  // drawn as a line that ends at the landing marker.
  const landingApproach = useMemo((): [number, number][] | null => {
    if (activeType !== "fixedWingLanding" && activeType !== "vtolLanding") return null;
    if (!patternResult || patternResult.waypoints.length < 2) return null;
    return patternResult.waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]);
  }, [activeType, patternResult]);

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

      {/* ── Structure-scan boundary overlay ──────────────────── */}
      {structureBoundary && activeType === "structureScan" && (
        <Polygon
          positions={structureBoundary.map((v) => [v[0], v[1]] as [number, number])}
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

      {/* ── SAR expanding-square coverage ring ───────────────── */}
      {expandingSquareRing && (
        <LeafletCircle
          center={[expandingSquareRing.center[0], expandingSquareRing.center[1]]}
          radius={expandingSquareRing.radius}
          pathOptions={SAR_PREVIEW_OPTS}
        />
      )}

      {/* ── SAR sector-search coverage ring ──────────────────── */}
      {sectorSearchRing && (
        <LeafletCircle
          center={[sectorSearchRing.center[0], sectorSearchRing.center[1]]}
          radius={sectorSearchRing.radius}
          pathOptions={SAR_PREVIEW_OPTS}
        />
      )}

      {/* ── SAR parallel-track coverage rectangle ────────────── */}
      {parallelTrackBoundary && (
        <Polygon
          positions={parallelTrackBoundary.map((v) => [v[0], v[1]] as [number, number])}
          pathOptions={SAR_PREVIEW_OPTS}
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

      {/* ── Landing approach path ────────────────────────────── */}
      {landingApproach && landingApproach.length >= 2 && (
        <Polyline
          positions={landingApproach}
          pathOptions={{
            color: PATTERN_COLOR,
            weight: 2,
            dashArray: "6 4",
            opacity: 0.85,
          }}
        />
      )}

      {/* ── Landing point marker ─────────────────────────────── */}
      {landingMarker && (
        <CircleMarker
          center={[landingMarker[0], landingMarker[1]]}
          radius={7}
          pathOptions={{
            color: LANDING_COLOR,
            fillColor: LANDING_COLOR,
            fillOpacity: 0.9,
            weight: 2,
          }}
        />
      )}

      {/* ── Applied-pattern boundary (no active pattern) ─────── */}
      {!activeType && appliedBoundary?.kind === "polygon" && (
        <Polygon
          positions={appliedBoundary.positions.map((v) => [v[0], v[1]] as [number, number])}
          pathOptions={APPLIED_FILL_OPTS}
        />
      )}
      {!activeType && appliedBoundary?.kind === "polyline" && (
        <Polyline
          positions={appliedBoundary.positions.map((v) => [v[0], v[1]] as [number, number])}
          pathOptions={APPLIED_LINE_OPTS}
        />
      )}
      {!activeType && appliedBoundary?.kind === "circle" && (
        <LeafletCircle
          center={[appliedBoundary.center[0], appliedBoundary.center[1]]}
          radius={appliedBoundary.radius}
          pathOptions={APPLIED_FILL_OPTS}
        />
      )}
      {!activeType && appliedBoundary?.kind === "point" && (
        <CircleMarker
          center={[appliedBoundary.center[0], appliedBoundary.center[1]]}
          radius={5}
          pathOptions={APPLIED_POINT_OPTS}
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
