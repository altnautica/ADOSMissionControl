/**
 * @module use-viewport-awareness
 * @description Hook that subscribes to CesiumJS camera movements and computes
 * viewport-aware state: visible airports, camera altitude,
 * and auto-panel suggestions.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Cartographic, Math as CesiumMath, type Viewer as CesiumViewer } from "cesium";
import { useAirspaceStore } from "@/stores/airspace-store";
import { getAirportsSync, type Airport } from "@/lib/airspace/airport-database";

/** Haversine distance in meters between two lat/lon points. */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ViewportAwareness {
  cameraAltitude: number;
  visibleAirports: Airport[];
  autoPanel: { type: "airport"; airport: Airport } | null;
}

export function useViewportAwareness(viewer: CesiumViewer | null): ViewportAwareness {
  const setViewportState = useAirspaceStore((s) => s.setViewportState);
  const updateIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [awareness, setAwareness] = useState<ViewportAwareness>({
    cameraAltitude: 10_000_000,
    visibleAirports: [],
    autoPanel: null,
  });

  const computeViewport = useCallback(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const cartographic = Cartographic.fromCartesian(viewer.camera.positionWC);
    const cameraAlt = cartographic.height;
    const camLat = CesiumMath.toDegrees(cartographic.latitude);
    const camLon = CesiumMath.toDegrees(cartographic.longitude);

    // Rough visible radius based on camera altitude (simplified)
    const visibleRadiusKm = Math.min(cameraAlt / 100, 500);

    // Find airports within visible radius
    const airports = getAirportsSync();
    const visibleAirports = airports.filter(
      (a) => haversine(camLat, camLon, a.lat, a.lon) / 1000 < visibleRadiusKm,
    );

    // Auto-panel: if zoomed < 50km and one dominant airport nearby
    let autoPanel: ViewportAwareness["autoPanel"] = null;
    if (cameraAlt < 50_000 && visibleAirports.length > 0) {
      // Find the closest airport
      let closest: Airport | null = null;
      let closestDist = Infinity;
      for (const ap of visibleAirports) {
        const d = haversine(camLat, camLon, ap.lat, ap.lon);
        if (d < closestDist) {
          closestDist = d;
          closest = ap;
        }
      }
      if (closest && closestDist < 50_000) {
        autoPanel = { type: "airport", airport: closest };
      }
    }

    setViewportState({ cameraAlt, visibleAirports, aircraftInView: 0 });

    const result: ViewportAwareness = { cameraAltitude: cameraAlt, visibleAirports, autoPanel };
    setAwareness(result);
  }, [viewer, setViewportState]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const handler = () => {
      // Debounce camera moves to avoid excessive computation
      if (updateIntervalRef.current) clearTimeout(updateIntervalRef.current);
      updateIntervalRef.current = setTimeout(computeViewport, 150);
    };

    viewer.camera.moveEnd.addEventListener(handler);
    computeViewport(); // initial computation

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.camera.moveEnd.removeEventListener(handler);
      }
      if (updateIntervalRef.current) clearTimeout(updateIntervalRef.current);
    };
  }, [viewer, computeViewport]);

  return awareness;
}
