/**
 * @module use-validation-options
 * @description Single source of truth for building mission `ValidationOptions`
 * from the geofence + rally + planner stores, shared by the Plan tab's
 * ValidationPanel, the Simulate tab's banner and the upload gate so all three
 * surfaces gate the fence identically (no phantom errors from stale inactive
 * geometry), enforce zones + rally, and resolve altitudes in the SAME frame the
 * upload will use.
 *
 * The frame is the load-bearing part. Planner-drawn waypoints carry
 * `frame: undefined`, and the operator can set the mission default to
 * `absolute` or `terrain`. This hook used to return only `{geofence, rally}`
 * and never set `defaultFrame`, so `validateMission` fell back to
 * `DEFAULT_ALTITUDE_FRAME = "relative"` regardless: with the default set to
 * `absolute`, an entered 120 m is 120 m MSL — 380 m UNDERGROUND over 500 m
 * terrain — and `resolveWaypointAltitude` treated it as 120 m above home, so
 * the TERRAIN_CLEARANCE rule passed clean. It also early-returned `undefined`
 * when there was no fence and no rally, which discarded the frame entirely.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import type { ValidationOptions } from "@/lib/validation/mission-validator";

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

  return useMemo(() => {
    // Primary fence geometry is gated on `enabled` and the active `fenceType`, so
    // switching fence type never leaves stale geometry driving a false breach.
    // Multi-zone fences are explicit keep-in/keep-out areas — enforced whenever
    // present, independent of the legacy primary-fence toggle.
    const geofence: NonNullable<ValidationOptions["geofence"]> = {};
    if (enabled) {
      if (maxAltitude > 0) geofence.maxAltitude = maxAltitude;
      if (minAltitude > 0) geofence.minAltitude = minAltitude;
      if (fenceType === "polygon" && polygonPoints.length >= 3) geofence.polygonPoints = polygonPoints;
      if (fenceType === "circle" && circleCenter) {
        geofence.circleCenter = circleCenter;
        geofence.circleRadius = circleRadius;
      }
    }
    if (zones.length > 0) geofence.zones = zones;

    const hasFence = Object.keys(geofence).length > 0;
    const rally = rallyPoints.length > 0 ? rallyPoints : undefined;
    // Always return options: the frame must reach the validator even with no
    // fence and no rally, or every altitude rule silently resolves in the
    // wrong datum.
    return {
      geofence: hasFence ? geofence : undefined,
      rally,
      defaultFrame,
    };
  }, [enabled, fenceType, maxAltitude, minAltitude, polygonPoints, circleCenter, circleRadius, zones, rallyPoints, defaultFrame]);
}
