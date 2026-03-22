/**
 * @module FlightTrailEntities
 * @description Renders aircraft position trails as Cesium PolylineCollection
 * primitives. Trail color matches aircraft threat level with fading alpha.
 * Material and Color objects are cached by threat level to avoid per-frame allocations.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Color,
  PolylineCollection,
  Material,
  type Viewer as CesiumViewer,
  type Polyline,
} from "cesium";
import { useTrafficStore } from "@/stores/traffic-store";
import { useAirspaceStore } from "@/stores/airspace-store";

import { THREAT_COLORS, type ThreatLevel } from "@/lib/airspace/types";

interface FlightTrailEntitiesProps {
  viewer: CesiumViewer | null;
}

// ── Cached Material objects by threat level (avoids per-frame WebGL shader work) ──
const trailMaterialCache = new Map<string, Material>();
function getTrailMaterial(threat: ThreatLevel): Material {
  const key = threat as string;
  let m = trailMaterialCache.get(key);
  if (!m) {
    const hex = THREAT_COLORS[threat] ?? THREAT_COLORS.other;
    const color = Color.fromCssColorString(hex).withAlpha(0.6);
    m = Material.fromType("Color", { color });
    trailMaterialCache.set(key, m);
  }
  return m;
}

export function FlightTrailEntities({ viewer }: FlightTrailEntitiesProps) {
  const aircraftTrails = useTrafficStore((s) => s.aircraftTrails);
  const threatLevels = useTrafficStore((s) => s.threatLevels);
  const trailsVisible = useAirspaceStore((s) => s.layerVisibility.trails);

  const polyCollRef = useRef<PolylineCollection | null>(null);
  const polyIndexRef = useRef<Map<string, Polyline>>(new Map());

  // Initialize PolylineCollection
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const polyColl = new PolylineCollection();
    viewer.scene.primitives.add(polyColl);
    polyCollRef.current = polyColl;

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(polyColl);
      }
      polyCollRef.current = null;
      polyIndexRef.current.clear();
    };
  }, [viewer]);

  // Update polylines when trails change
  useEffect(() => {
    const polyColl = polyCollRef.current;
    if (!polyColl || !viewer || viewer.isDestroyed() || !aircraftTrails) return;

    // When trails layer is hidden, remove all polylines
    if (!trailsVisible) {
      for (const [, polyline] of polyIndexRef.current) {
        polyColl.remove(polyline);
      }
      polyIndexRef.current.clear();
      viewer.scene.requestRender();
      return;
    }

    const currentIcaos = new Set<string>();

    for (const [icao24, trail] of aircraftTrails) {
      if (trail.length < 2) continue;
      currentIcaos.add(icao24);

      const threat: ThreatLevel = threatLevels.get(icao24) ?? "other";
      const material = getTrailMaterial(threat);
      const positions = trail.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, p.alt));

      const existing = polyIndexRef.current.get(icao24);
      if (existing) {
        existing.positions = positions;
        existing.material = material;
      } else {
        const polyline = polyColl.add({
          positions,
          width: 2,
          material,
        });
        polyIndexRef.current.set(icao24, polyline);
      }
    }

    // Remove stale trails
    for (const [icao24, polyline] of polyIndexRef.current) {
      if (!currentIcaos.has(icao24)) {
        polyColl.remove(polyline);
        polyIndexRef.current.delete(icao24);
      }
    }

  }, [viewer, aircraftTrails, threatLevels, trailsVisible]);

  return null;
}
