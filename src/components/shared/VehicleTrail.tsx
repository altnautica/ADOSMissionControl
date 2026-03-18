/**
 * @module VehicleTrail
 * @description Renders the accumulated drone position trail as a Leaflet
 * polyline on any react-leaflet MapContainer. Reads from the trail store.
 * Must be rendered inside a MapContainer (or MapWrapper) as a child.
 * @license GPL-3.0-only
 */

"use client";

import { useTrailStore } from "@/stores/trail-store";
import { Polyline } from "react-leaflet";

export function VehicleTrail() {
  useTrailStore((s) => s._version); // subscribe to updates
  const trail = useTrailStore.getState()._ring.toArray();

  if (trail.length < 2) return null;

  const positions: [number, number][] = trail.map((p) => [p.lat, p.lon]);

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: "#3A82FF",
        weight: 2,
        opacity: 0.7,
        dashArray: undefined,
      }}
    />
  );
}
