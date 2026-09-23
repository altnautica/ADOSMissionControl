/**
 * @module use-validation-options
 * @description Single source of truth for building mission `ValidationOptions`
 * from the geofence + rally + planner stores, shared by the Plan tab's
 * ValidationPanel, the Simulate tab's banner, the upload gate and the plugin
 * `mission.write` handler so every surface gates the fence identically (no
 * phantom errors from stale inactive geometry), enforces zones + rally, and
 * resolves altitudes in the SAME frame the upload will use.
 *
 * The frame is the load-bearing part. Planner-drawn waypoints carry
 * `frame: undefined`, and the operator can set the mission default to
 * `absolute` or `terrain`. Without `defaultFrame`, `validateMission` falls back
 * to `DEFAULT_ALTITUDE_FRAME = "relative"` regardless: with the default set to
 * `absolute`, an entered 120 m is 120 m MSL — 380 m UNDERGROUND over 500 m
 * terrain — and `resolveWaypointAltitude` would treat it as 120 m above home, so
 * the TERRAIN_CLEARANCE rule would pass clean. Options are always returned,
 * even with no fence and no rally, so the frame is never discarded.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useGeofenceStore, type FenceType, type FenceZone } from "@/stores/geofence-store";
import { useRallyStore, type RallyPoint } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import type { AltitudeFrame } from "@/lib/types";
import type { ValidationOptions } from "@/lib/validation/mission-validator";

/** The store fields the validation options are derived from. */
export interface ValidationOptionsSnapshot {
  enabled: boolean;
  fenceType: FenceType;
  maxAltitude: number;
  minAltitude: number;
  polygonPoints: [number, number][];
  circleCenter: [number, number] | null;
  circleRadius: number;
  zones: FenceZone[];
  rallyPoints: RallyPoint[];
  defaultFrame: AltitudeFrame;
}

/**
 * Build `ValidationOptions` from a store snapshot. Pure: callers outside React
 * pass {@link readValidationOptionsSnapshot}; the hook passes its selectors.
 */
export function buildValidationOptions(s: ValidationOptionsSnapshot): ValidationOptions {
  // Primary fence geometry is gated on `enabled` and the active `fenceType`, so
  // switching fence type never leaves stale geometry driving a false breach.
  // Multi-zone fences are explicit keep-in/keep-out areas — enforced whenever
  // present, independent of the legacy primary-fence toggle.
  const geofence: NonNullable<ValidationOptions["geofence"]> = {};
  if (s.enabled) {
    if (s.maxAltitude > 0) geofence.maxAltitude = s.maxAltitude;
    if (s.minAltitude > 0) geofence.minAltitude = s.minAltitude;
    if (s.fenceType === "polygon" && s.polygonPoints.length >= 3) geofence.polygonPoints = s.polygonPoints;
    if (s.fenceType === "circle" && s.circleCenter) {
      geofence.circleCenter = s.circleCenter;
      geofence.circleRadius = s.circleRadius;
    }
  }
  if (s.zones.length > 0) geofence.zones = s.zones;

  const hasFence = Object.keys(geofence).length > 0;
  const rally = s.rallyPoints.length > 0 ? s.rallyPoints : undefined;
  return {
    geofence: hasFence ? geofence : undefined,
    rally,
    defaultFrame: s.defaultFrame,
  };
}

/** Read the current store snapshot, for non-React callers. */
export function readValidationOptionsSnapshot(): ValidationOptionsSnapshot {
  const g = useGeofenceStore.getState();
  return {
    enabled: g.enabled,
    fenceType: g.fenceType,
    maxAltitude: g.maxAltitude,
    minAltitude: g.minAltitude,
    polygonPoints: g.polygonPoints,
    circleCenter: g.circleCenter,
    circleRadius: g.circleRadius,
    zones: g.zones,
    rallyPoints: useRallyStore.getState().points,
    defaultFrame: usePlannerStore.getState().defaultFrame,
  };
}

export function useValidationOptions(): ValidationOptions {
  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const maxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const minAltitude = useGeofenceStore((s) => s.minAltitude);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const zones = useGeofenceStore((s) => s.zones);
  const rallyPoints = useRallyStore((s) => s.points);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);

  return useMemo(
    () =>
      buildValidationOptions({
        enabled,
        fenceType,
        maxAltitude,
        minAltitude,
        polygonPoints,
        circleCenter,
        circleRadius,
        zones,
        rallyPoints,
        defaultFrame,
      }),
    [enabled, fenceType, maxAltitude, minAltitude, polygonPoints, circleCenter, circleRadius, zones, rallyPoints, defaultFrame],
  );
}
