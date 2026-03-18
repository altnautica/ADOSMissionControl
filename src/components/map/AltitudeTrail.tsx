/**
 * @module AltitudeTrail
 * @description Renders the drone trail as color-coded polyline segments based
 * on relative altitude. Low = green, mid = yellow, high = red. Falls back to
 * the standard accent blue trail when no altitude data is available.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { Polyline, Tooltip } from "react-leaflet";
import { useTrailStore, type TrailPoint } from "@/stores/trail-store";

/** Altitude band thresholds in meters AGL. */
const ALT_LOW = 10;
const ALT_MID = 50;
const ALT_HIGH = 120;

/** Color for altitude value using green-yellow-red gradient. */
function altitudeColor(alt: number): string {
  if (alt <= ALT_LOW) return "#22c55e";   // green
  if (alt <= ALT_MID) {
    // green to yellow
    const t = (alt - ALT_LOW) / (ALT_MID - ALT_LOW);
    const r = Math.round(34 + t * (234 - 34));
    const g = Math.round(197 + t * (179 - 197));
    const b = Math.round(94 + t * (8 - 94));
    return `rgb(${r},${g},${b})`;
  }
  if (alt <= ALT_HIGH) {
    // yellow to red
    const t = (alt - ALT_MID) / (ALT_HIGH - ALT_MID);
    const r = Math.round(234 + t * (239 - 234));
    const g = Math.round(179 - t * 179);
    const b = Math.round(8 - t * 8);
    return `rgb(${r},${g},${b})`;
  }
  return "#ef4444"; // red for above HIGH
}

interface TrailSegment {
  positions: [number, number][];
  color: string;
  avgAlt: number;
}

/** Group consecutive trail points into segments of the same color band. */
function buildSegments(trail: TrailPoint[]): TrailSegment[] {
  if (trail.length < 2) return [];

  const segments: TrailSegment[] = [];
  let currentColor = altitudeColor(trail[0].alt);
  let currentPositions: [number, number][] = [[trail[0].lat, trail[0].lon]];
  let altSum = trail[0].alt;
  let altCount = 1;

  for (let i = 1; i < trail.length; i++) {
    const color = altitudeColor(trail[i].alt);
    const pos: [number, number] = [trail[i].lat, trail[i].lon];

    if (color === currentColor) {
      currentPositions.push(pos);
      altSum += trail[i].alt;
      altCount++;
    } else {
      // Close current segment (overlap the last point for continuity)
      segments.push({
        positions: currentPositions,
        color: currentColor,
        avgAlt: altSum / altCount,
      });
      // Start new segment from previous point
      currentPositions = [currentPositions[currentPositions.length - 1], pos];
      currentColor = color;
      altSum = trail[i].alt;
      altCount = 1;
    }
  }

  // Push final segment
  if (currentPositions.length >= 2) {
    segments.push({
      positions: currentPositions,
      color: currentColor,
      avgAlt: altSum / altCount,
    });
  }

  return segments;
}

export function AltitudeTrail() {
  const version = useTrailStore((s) => s._version);
  const trail = useTrailStore.getState()._ring.toArray();

  const hasAltData = useMemo(
    () => trail.some((p) => p.alt !== 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const segments = useMemo(() => {
    if (!hasAltData) return [];
    return buildSegments(trail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, hasAltData]);

  // No altitude data — render simple blue trail like VehicleTrail
  if (!hasAltData) {
    if (trail.length < 2) return null;
    const positions: [number, number][] = trail.map((p) => [p.lat, p.lon]);
    return (
      <Polyline
        positions={positions}
        pathOptions={{ color: "#3A82FF", weight: 2, opacity: 0.7 }}
      />
    );
  }

  return (
    <>
      {segments.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg.positions}
          pathOptions={{
            color: seg.color,
            weight: 2.5,
            opacity: 0.85,
          }}
        >
          <Tooltip direction="top" sticky>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
              ~{seg.avgAlt.toFixed(0)}m AGL
            </span>
          </Tooltip>
        </Polyline>
      ))}
    </>
  );
}
