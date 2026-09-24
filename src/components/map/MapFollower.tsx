"use client";

/**
 * @module map/MapFollower
 * @description Keeps a Leaflet map centred on a moving position. Re-centres
 * only when the position has moved visibly and without animation: the caller
 * re-renders at telemetry rate with a fresh position array each time, and a
 * pan restarted at that rate never finishes and keeps the map in motion.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useMap } from "react-leaflet";

const FOLLOW_THRESHOLD_PX = 2;

export function MapFollower({ position, follow }: { position: [number, number] | null; follow: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!follow || !position) return;
    const moved = map
      .latLngToContainerPoint(position)
      .distanceTo(map.latLngToContainerPoint(map.getCenter()));
    if (moved < FOLLOW_THRESHOLD_PX) return;
    map.setView(position, map.getZoom(), { animate: false });
  }, [map, position, follow]);

  return null;
}
