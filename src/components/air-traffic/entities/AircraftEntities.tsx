/**
 * @module AircraftEntities
 * @description Renders live aircraft positions using GPU-instanced
 * BillboardCollection + LabelCollection primitives for 10K+ aircraft at 60fps.
 * No clustering — all aircraft visible at every zoom level (Flightradar24 style).
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import {
  Cartesian3,
  Cartesian2,
  Cartographic,
  Color,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  Math as CesiumMath,
  BillboardCollection,
  LabelCollection,
  type Viewer as CesiumViewer,
  type Billboard,
  type Label,
} from "cesium";
import { useTrafficStore, type DisplayMode } from "@/stores/traffic-store";
import { useAirspaceStore } from "@/stores/airspace-store";
import { THREAT_COLORS, type ThreatLevel } from "@/lib/airspace/types";
import { getAircraftIcon, getAircraftColorForThreat } from "@/lib/airspace/aircraft-icons";

interface AircraftEntitiesProps {
  viewer: CesiumViewer | null;
}

/** Billboard index entry for O(1) lookup by icao24. */
interface BillboardEntry {
  billboard: Billboard;
  label: Label;
  icao24: string;
}

/** Determine display mode from camera altitude in meters. */
function getDisplayMode(altitudeM: number): DisplayMode {
  if (altitudeM > 500_000) return "global";
  if (altitudeM > 50_000) return "regional";
  if (altitudeM > 5_000) return "local";
  return "close";
}

interface ViewBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

function getVisibleBounds(viewer: CesiumViewer): ViewBounds | null {
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) return null;
  return {
    south: CesiumMath.toDegrees(rect.south),
    north: CesiumMath.toDegrees(rect.north),
    west: CesiumMath.toDegrees(rect.west),
    east: CesiumMath.toDegrees(rect.east),
  };
}

/** Icon pixel size by display mode. */
function getIconSize(mode: DisplayMode): number {
  switch (mode) {
    case "global": return 16;
    case "regional": return 24;
    case "local":
    case "close": return 32;
  }
}

// ── Cached Color objects to avoid per-frame allocations ──
const cesiumColorCache = new Map<string, Color>();
function getCachedColor(hex: string, alpha?: number): Color {
  const key = alpha !== undefined ? `${hex}-${alpha}` : hex;
  let c = cesiumColorCache.get(key);
  if (!c) {
    c = Color.fromCssColorString(hex);
    if (alpha !== undefined) c = c.withAlpha(alpha);
    cesiumColorCache.set(key, c);
  }
  return c;
}
const LABEL_BG_COLOR = getCachedColor("#0a0a0f", 0.7);
const LABEL_PIXEL_OFFSET = new Cartesian2(0, -16);
const LABEL_BG_PADDING = new Cartesian2(4, 2);

/** Handle for parent to pick aircraft by billboard reference */
export interface AircraftEntitiesHandle {
  findByBillboard: (billboard: Billboard) => string | null;
}

export const AircraftEntities = forwardRef<AircraftEntitiesHandle, AircraftEntitiesProps>(
  function AircraftEntities({ viewer }, ref) {
  const aircraft = useTrafficStore((s) => s.aircraft);
  const threatLevels = useTrafficStore((s) => s.threatLevels);
  const selectedAircraft = useTrafficStore((s) => s.selectedAircraft);
  const setDisplayMode = useTrafficStore((s) => s.setDisplayMode);
  const trafficVisible = useAirspaceStore((s) => s.layerVisibility.traffic);

  const billboardCollRef = useRef<BillboardCollection | null>(null);
  const labelCollRef = useRef<LabelCollection | null>(null);
  /** Map from icao24 -> { billboard, label } for O(1) updates. */
  const indexRef = useRef<Map<string, BillboardEntry>>(new Map());
  /** Current display mode for icon sizing and label visibility. */
  const modeRef = useRef<DisplayMode>("global");
  /** Visible viewport bounds for frustum culling (ref to avoid re-renders on camera move). */
  const visibleBoundsRef = useRef<ViewBounds | null>(null);

  // Expose billboard-to-icao24 lookup for parent click handler
  useImperativeHandle(ref, () => ({
    findByBillboard: (billboard: Billboard): string | null => {
      for (const [icao24, entry] of indexRef.current) {
        if (entry.billboard === billboard) return icao24;
      }
      return null;
    },
  }), []);

  // Initialize BillboardCollection + LabelCollection
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const bbColl = new BillboardCollection({ scene: viewer.scene });
    const lblColl = new LabelCollection({ scene: viewer.scene });
    viewer.scene.primitives.add(bbColl);
    viewer.scene.primitives.add(lblColl);
    billboardCollRef.current = bbColl;
    labelCollRef.current = lblColl;

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(bbColl);
        viewer.scene.primitives.remove(lblColl);
      }
      billboardCollRef.current = null;
      labelCollRef.current = null;
      indexRef.current.clear();
    };
  }, [viewer]);

  // Camera move listener for LOD
  const handleCameraMove = useCallback(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const cartographic = Cartographic.fromCartesian(viewer.camera.positionWC);
    const altM = cartographic.height;
    const mode = getDisplayMode(altM);

    // Update viewport bounds ref for frustum culling (no React re-render)
    visibleBoundsRef.current = getVisibleBounds(viewer);

    if (modeRef.current !== mode) {
      modeRef.current = mode;
      setDisplayMode(mode);

      // Update all icon sizes and label visibility
      const showLabels = mode === "local" || mode === "close";
      const size = getIconSize(mode);
      const scale = size / 32; // billboards are 32x32 base

      for (const entry of indexRef.current.values()) {
        entry.billboard.scale = scale;
        entry.label.show = showLabels;
      }

    }
  }, [viewer, setDisplayMode]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.moveEnd.addEventListener(handleCameraMove);
    handleCameraMove(); // initial
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.camera.moveEnd.removeEventListener(handleCameraMove);
      }
    };
  }, [viewer, handleCameraMove]);

  // Update billboards when aircraft data changes
  useEffect(() => {
    const bbColl = billboardCollRef.current;
    const lblColl = labelCollRef.current;
    if (!bbColl || !lblColl || !viewer || viewer.isDestroyed()) return;

    // When traffic layer is toggled OFF, remove all billboards/labels
    if (!trafficVisible) {
      for (const entry of indexRef.current.values()) {
        bbColl.remove(entry.billboard);
        lblColl.remove(entry.label);
      }
      indexRef.current.clear();
      viewer.scene.requestRender();
      return;
    }

    const mode = modeRef.current;
    const showLabels = mode === "local" || mode === "close";
    const iconSize = getIconSize(mode);
    const scale = iconSize / 32;
    const currentIcaos = new Set<string>();

    const bounds = visibleBoundsRef.current;
    const latM = bounds ? (bounds.north - bounds.south) * 0.1 : 0;
    const lonM = bounds ? (bounds.east - bounds.west) * 0.1 : 0;

    for (const [icao24, ac] of aircraft) {
      // Skip zero-position aircraft
      if (ac.lat === 0 && ac.lon === 0) continue;

      // Viewport culling with 10% margin
      if (bounds) {
        if (bounds.west <= bounds.east) {
          // Normal case
          if (ac.lat < bounds.south - latM || ac.lat > bounds.north + latM ||
              ac.lon < bounds.west - lonM || ac.lon > bounds.east + lonM) continue;
        } else {
          // Antimeridian wrap
          if (ac.lat < bounds.south - latM || ac.lat > bounds.north + latM ||
              (ac.lon < bounds.west - lonM && ac.lon > bounds.east + lonM)) continue;
        }
      }

      currentIcaos.add(icao24);

      const threat: ThreatLevel = threatLevels.get(icao24) ?? "other";
      const isSelected = selectedAircraft === icao24;
      const color = getAircraftColorForThreat(threat, isSelected);
      const altM = ac.altitudeMsl ?? 0;
      const heading = ac.heading ?? 0;
      const rotation = CesiumMath.toRadians(-heading);
      const position = Cartesian3.fromDegrees(ac.lon, ac.lat, altM);
      const callsign = ac.callsign?.trim() || icao24.toUpperCase();
      const imageUri = getAircraftIcon(color, 32);
      const bbScale = isSelected ? scale * 1.5 : scale;
      const threatColor = getCachedColor(THREAT_COLORS[threat] ?? THREAT_COLORS.other);

      const existing = indexRef.current.get(icao24);
      if (existing) {
        // Update existing billboard
        existing.billboard.position = position;
        existing.billboard.rotation = rotation;
        existing.billboard.image = imageUri;
        existing.billboard.scale = bbScale;
        existing.billboard.show = true;

        // Update label
        existing.label.position = position;
        existing.label.text = callsign;
        existing.label.show = showLabels;
        existing.label.fillColor = threatColor;
      } else {
        // Add new billboard + label
        const billboard = bbColl.add({
          position,
          image: imageUri,
          scale: bbScale,
          rotation,
          alignedAxis: Cartesian3.UNIT_Z,
          verticalOrigin: VerticalOrigin.CENTER,
          horizontalOrigin: HorizontalOrigin.CENTER,
          disableDepthTestDistance: 5000,
        });

        const label = lblColl.add({
          position,
          text: callsign,
          font: "10px monospace",
          show: showLabels,
          fillColor: threatColor,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: LABEL_PIXEL_OFFSET,
          disableDepthTestDistance: 5000,
          showBackground: true,
          backgroundColor: LABEL_BG_COLOR,
          backgroundPadding: LABEL_BG_PADDING,
        });

        indexRef.current.set(icao24, { billboard, label, icao24 });
      }
    }

    // Remove stale entries
    for (const [icao24, entry] of indexRef.current) {
      if (!currentIcaos.has(icao24)) {
        bbColl.remove(entry.billboard);
        lblColl.remove(entry.label);
        indexRef.current.delete(icao24);
      }
    }

    // Trigger Cesium render (requestRenderMode requires explicit render)
    viewer.scene.requestRender();

  }, [viewer, aircraft, threatLevels, selectedAircraft, trafficVisible]);

  return null;
});
