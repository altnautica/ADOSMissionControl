/**
 * @module JumpArrowOverlay
 * @description Renders curved arrows on the map for DO_JUMP waypoints,
 * showing the jump source → target relationship.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { Polyline, Marker } from "react-leaflet";
import L from "leaflet";
import type { Waypoint } from "@/lib/types";

interface JumpArrowOverlayProps {
  waypoints: Waypoint[];
}

/**
 * Generate a curved arc between two lat/lon points (for visual clarity).
 */
function generateArc(
  from: [number, number],
  to: [number, number],
  segments = 20,
): [number, number][] {
  const points: [number, number][] = [];
  const midLat = (from[0] + to[0]) / 2;
  const midLon = (from[1] + to[1]) / 2;

  // Perpendicular offset for curve (10% of distance)
  const dLat = to[0] - from[0];
  const dLon = to[1] - from[1];
  const offset = Math.sqrt(dLat * dLat + dLon * dLon) * 0.15;
  const controlLat = midLat + (-dLon / Math.sqrt(dLat * dLat + dLon * dLon || 1)) * offset;
  const controlLon = midLon + (dLat / Math.sqrt(dLat * dLat + dLon * dLon || 1)) * offset;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const lat = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * controlLat + t * t * to[0];
    const lon = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * controlLon + t * t * to[1];
    points.push([lat, lon]);
  }

  return points;
}

const arrowIcon = L.divIcon({
  className: "",
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  html: `<svg width="12" height="12" viewBox="0 0 12 12"><text x="6" y="9" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="monospace">J</text></svg>`,
});

export function JumpArrowOverlay({ waypoints }: JumpArrowOverlayProps) {
  const jumpArrows = useMemo(() => {
    const arrows: { from: [number, number]; to: [number, number]; label: string }[] = [];

    // A DO_JUMP now rides as an action attached to the waypoint it fires at, and
    // targets another waypoint by stable id, so an arrow runs from that waypoint
    // to the target the id resolves to.
    for (const wp of waypoints) {
      for (const action of wp.actions ?? []) {
        if (action.command !== "DO_JUMP" || !action.jumpTargetId) continue;
        // A repeat count of 0 is never taken by the flight controller.
        const count = action.param2 ?? 0;
        if (count === 0) continue;

        const targetIdx = waypoints.findIndex((w) => w.id === action.jumpTargetId);
        if (targetIdx < 0) continue;

        const targetWp = waypoints[targetIdx];
        const repeat = count < 0 ? " ×∞" : count > 1 ? ` ×${count}` : "";
        arrows.push({
          from: [wp.lat, wp.lon],
          to: [targetWp.lat, targetWp.lon],
          label: `J→${targetIdx + 1}${repeat}`,
        });
      }
    }

    return arrows;
  }, [waypoints]);

  if (jumpArrows.length === 0) return null;

  return (
    <>
      {jumpArrows.map((arrow, i) => {
        const arc = generateArc(arrow.from, arrow.to);
        const midpoint = arc[Math.floor(arc.length / 2)];
        return (
          <div key={`jump-${arrow.from[0].toFixed(5)}-${arrow.to[0].toFixed(5)}-${arrow.label}`}>
            <Polyline
              positions={arc}
              pathOptions={{
                color: "#f59e0b",
                weight: 2,
                dashArray: "6 4",
                opacity: 0.8,
              }}
              interactive={false}
            />
            <Marker
              position={midpoint}
              icon={arrowIcon}
              interactive={false}
            />
          </div>
        );
      })}
    </>
  );
}
