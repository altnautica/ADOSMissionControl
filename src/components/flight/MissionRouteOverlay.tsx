"use client";

/**
 * @module MissionRouteOverlay
 * @description The route of the mission the aircraft is flying and the
 * waypoint it is heading to, inside a react-leaflet MapContainer. Drawn only
 * while MISSION_CURRENT maps onto the open plan, which the mission store does
 * only when the aircraft holds that plan (an upload or download receipt), so a
 * plan the vehicle does not hold is never drawn as its route.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import { useMissionStore } from "@/stores/mission-store";
import { useCssVarColors } from "@/hooks/use-css-var-colors";

/** Route in the accent, the waypoint being flown to in the warning hue.
 * Leaflet writes colours into SVG attributes, which cannot hold var(). */
const ROUTE_TOKENS = ["--alt-accent-primary", "--alt-status-warning"] as const;

export function MissionRouteOverlay() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const current = useMissionStore((s) => s.currentWaypoint);
  const [routeColor, activeColor] = useCssVarColors(ROUTE_TOKENS);

  // Waypoints with a position, keeping their mission index for the readout.
  const points = useMemo(
    () =>
      waypoints.flatMap((wp, index) =>
        wp.lat !== 0 || wp.lon !== 0 ? [{ index, pos: [wp.lat, wp.lon] as [number, number] }] : [],
      ),
    [waypoints],
  );
  const route = useMemo(() => points.map((p) => p.pos), [points]);

  if (current === null || points.length === 0) return null;
  const active = points.find((p) => p.index === current);

  return (
    <>
      {route.length >= 2 && (
        <Polyline
          positions={route}
          interactive={false}
          pathOptions={{ color: routeColor, weight: 3, opacity: 0.9 }}
        />
      )}
      {points.map((p) =>
        p.index === current ? null : (
          <CircleMarker
            key={p.index}
            center={p.pos}
            radius={4}
            interactive={false}
            pathOptions={{ color: routeColor, fillColor: routeColor, fillOpacity: 0.9, weight: 1 }}
          />
        ),
      )}
      {active && (
        <CircleMarker
          center={active.pos}
          radius={8}
          interactive={false}
          pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.85, weight: 2 }}
        >
          <Tooltip direction="top" offset={[0, -8]} permanent>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
              WP {active.index + 1}
            </span>
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}
