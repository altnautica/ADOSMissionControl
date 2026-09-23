/**
 * @module GeofenceZonesOverlay
 * @description Leaflet overlay for the geofence store's inclusion and
 * exclusion zones (polygons and circles).
 * @license GPL-3.0-only
 */

"use client";

import { Circle, Polygon, Tooltip } from "react-leaflet";
import { useGeofenceStore, type FenceZone } from "@/stores/geofence-store";

/** Colors for inclusion (green) and exclusion (red) zones */
const ZONE_COLORS = {
  inclusion: { stroke: "#22c55e", fill: "#22c55e" },
  exclusion: { stroke: "#ef4444", fill: "#ef4444" },
} as const;

// ── Zone Overlay ─────────────────────────────────────────────

function ZoneOverlay({ zone }: { zone: FenceZone }) {
  const colors = ZONE_COLORS[zone.role];

  if (zone.type === "polygon" && zone.polygonPoints.length >= 3) {
    return (
      <Polygon
        positions={zone.polygonPoints}
        pathOptions={{
          color: colors.stroke,
          weight: 2,
          dashArray: zone.role === "exclusion" ? "4 4" : "8 4",
          fillColor: colors.fill,
          fillOpacity: zone.role === "exclusion" ? 0.12 : 0.06,
        }}
      >
        <Tooltip direction="center" sticky>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
            {zone.role === "inclusion" ? "Inclusion" : "Exclusion"} Zone ({zone.polygonPoints.length} pts)
          </span>
        </Tooltip>
      </Polygon>
    );
  }

  if (zone.type === "circle" && zone.circleCenter && zone.circleRadius > 0) {
    return (
      <Circle
        center={zone.circleCenter}
        radius={zone.circleRadius}
        pathOptions={{
          color: colors.stroke,
          weight: 2,
          dashArray: zone.role === "exclusion" ? "4 4" : "8 4",
          fillColor: colors.fill,
          fillOpacity: zone.role === "exclusion" ? 0.12 : 0.06,
        }}
      >
        <Tooltip direction="top" sticky>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
            {zone.role === "inclusion" ? "Inclusion" : "Exclusion"} Zone {zone.circleRadius}m
          </span>
        </Tooltip>
      </Circle>
    );
  }

  return null;
}

/**
 * Renders the geofence store's inclusion/exclusion zones on a planning map.
 * Zones show whenever they exist — inclusion green, exclusion red-dashed.
 */
export function GeofenceZonesOverlay() {
  const zones = useGeofenceStore((s) => s.zones);
  if (zones.length === 0) return null;
  return (
    <>
      {zones.map((zone) => (
        <ZoneOverlay key={zone.id} zone={zone} />
      ))}
    </>
  );
}
