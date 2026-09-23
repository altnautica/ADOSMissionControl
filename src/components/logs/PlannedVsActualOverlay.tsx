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
import { pointToSegmentM } from "@/lib/geo/distance";

/** Minimum distance from a point to any segment of the planned path. */
function minDistToPath(
  lat: number, lon: number,
  path: [number, number][],
): number {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = pointToSegmentM([lat, lon], path[i], path[i + 1]);
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
  const ring = useTrailStore((s) => s._ring);
  const trailVersion = useTrailStore((s) => s._version);

  const plannedPositions = useMemo<[number, number][]>(
    () =>
      waypoints
        .filter((wp) => wp.lat !== 0 || wp.lon !== 0)
        .map((wp) => [wp.lat, wp.lon]),
    [waypoints]
  );

  // The ring mutates in place; the version is the trigger.
  const actualPositions = useMemo<[number, number][]>(() => {
    void trailVersion;
    return ring.toArray().map((p): [number, number] => [p.lat, p.lon]);
  }, [ring, trailVersion]);

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
