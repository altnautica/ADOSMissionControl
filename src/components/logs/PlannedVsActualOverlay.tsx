"use client";

/**
 * @module PlannedVsActualOverlay
 * @description Map overlay that renders planned mission waypoints as a blue
 * dashed polyline alongside the actual drone trail (white solid, from
 * trail-store). Shows red deviation markers where actual path deviates >5m
 * from planned path. Designed to be placed inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { Polyline, CircleMarker, Tooltip } from "react-leaflet";
import { useMissionStore } from "@/stores/mission-store";
import { useTrailStore } from "@/stores/trail-store";

/** Approximate distance in meters between two lat/lon points. */
function distanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Minimum distance from a point to a line segment (all in lat/lon).
 * Projects the point onto the segment and returns the distance in meters.
 */
function pointToSegmentDistance(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return distanceMeters(pLat, pLon, aLat, aLon);

  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projLat = aLat + t * dy;
  const projLon = aLon + t * dx;
  return distanceMeters(pLat, pLon, projLat, projLon);
}

/** Minimum distance from a point to any segment of the planned path. */
function minDistToPath(
  lat: number, lon: number,
  path: [number, number][],
): number {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = pointToSegmentDistance(
      lat, lon,
      path[i][0], path[i][1],
      path[i + 1][0], path[i + 1][1],
    );
    if (d < min) min = d;
  }
  return min;
}

/** Deviation threshold in meters. */
const DEVIATION_THRESHOLD = 5;

/** Max deviation markers to render (avoids flooding the map). */
const MAX_DEVIATION_MARKERS = 200;

interface DeviationPoint {
  pos: [number, number];
  deviation: number;
}

export function PlannedVsActualOverlay() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const trailVersion = useTrailStore((s) => s._version);
  const trail = useTrailStore.getState()._ring.toArray();

  const plannedPositions = useMemo<[number, number][]>(
    () =>
      waypoints
        .filter((wp) => wp.lat !== 0 || wp.lon !== 0)
        .map((wp) => [wp.lat, wp.lon]),
    [waypoints]
  );

  const actualPositions = useMemo<[number, number][]>(
    () => trail.map((p) => [p.lat, p.lon]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trailVersion]
  );

  // Find trail points that deviate >5m from the planned path
  const deviationMarkers = useMemo<DeviationPoint[]>(() => {
    if (plannedPositions.length < 2 || actualPositions.length < 2) return [];
    const markers: DeviationPoint[] = [];
    // Sample every few points to keep performance bounded
    const step = Math.max(1, Math.floor(actualPositions.length / 500));
    for (let i = 0; i < actualPositions.length; i += step) {
      const [lat, lon] = actualPositions[i];
      const dist = minDistToPath(lat, lon, plannedPositions);
      if (dist > DEVIATION_THRESHOLD) {
        markers.push({ pos: [lat, lon], deviation: dist });
        if (markers.length >= MAX_DEVIATION_MARKERS) break;
      }
    }
    return markers;
  }, [plannedPositions, actualPositions]);

  const hasPlanned = plannedPositions.length >= 2;
  const hasActual = actualPositions.length >= 2;

  if (!hasPlanned && !hasActual) return null;

  return (
    <>
      {/* Planned path — blue dashed */}
      {hasPlanned && (
        <>
          <Polyline
            positions={plannedPositions}
            pathOptions={{
              color: "#3A82FF",
              weight: 2,
              opacity: 0.7,
              dashArray: "8,6",
            }}
          />
          {/* Waypoint markers */}
          {plannedPositions.map((pos, i) => (
            <CircleMarker
              key={`wp-${i}`}
              center={pos}
              radius={3}
              pathOptions={{
                color: "#3A82FF",
                fillColor: "#3A82FF",
                fillOpacity: 0.8,
                weight: 1,
              }}
            >
              <Tooltip direction="top" permanent={false}>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                  }}
                >
                  WP {i + 1}
                </span>
              </Tooltip>
            </CircleMarker>
          ))}
        </>
      )}

      {/* Actual path — white solid */}
      {hasActual && (
        <Polyline
          positions={actualPositions}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            opacity: 0.85,
          }}
        />
      )}

      {/* Deviation markers — red circles where actual deviates >5m from planned */}
      {deviationMarkers.map((dm, i) => (
        <CircleMarker
          key={`dev-${i}`}
          center={dm.pos}
          radius={4}
          pathOptions={{
            color: "#ef4444",
            fillColor: "#ef4444",
            fillOpacity: 0.6,
            weight: 1,
          }}
        >
          <Tooltip direction="top" permanent={false}>
            <span
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 10,
                color: "#ef4444",
              }}
            >
              {dm.deviation.toFixed(1)}m off
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
