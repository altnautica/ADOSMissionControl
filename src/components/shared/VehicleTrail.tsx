/**
 * @module VehicleTrail
 * @description Renders the accumulated drone position trail as a Leaflet
 * polyline on any react-leaflet MapContainer. Reads from the trail store.
 * Must be rendered inside a MapContainer (or MapWrapper) as a child.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useTrailStore } from "@/stores/trail-store";
import { Polyline } from "react-leaflet";

export function VehicleTrail() {
  // The ring is a stable ref that is mutated in place, so re-read it when the
  // version bumps. Without the memo every unrelated render of this subtree
  // rebuilt a position array as long as the trail (up to a thousand points).
  const ring = useTrailStore((s) => s._ring);
  const version = useTrailStore((s) => s._version);

  const positions = useMemo<[number, number][]>(() => {
    void version; // the ring mutates in place; the version is the trigger
    return ring.toArray().map((p) => [p.lat, p.lon]);
  }, [ring, version]);

  if (positions.length < 2) return null;

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
