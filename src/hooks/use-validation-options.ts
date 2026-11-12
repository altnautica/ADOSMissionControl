/**
 * @module use-validation-options
 * @description Single source of truth for building mission `ValidationOptions`
 * from the geofence + rally + planner + mission stores, shared by the Plan
 * tab's ValidationPanel, the Simulate tab's banner, the upload gate and the
 * plugin `mission.write` handler so every surface gates the fence identically
 * (no phantom errors from stale inactive geometry), enforces zones + rally, and
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
 *
 * Home is the plan's planned home with its ground elevation; with none the
 * validator falls back to the plan's launch point. The vehicle profile picks
 * the autopilot-specific rules. The hook also passes the vehicle's configured
 * RTL altitude, TERRAIN_ENABLE and (ArduPlane) RTL_AUTOLAND when connected, and the ground profile
 * sampled along every flown leg.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useGeofenceStore, type FenceType, type FenceZone } from "@/stores/geofence-store";
import { useRallyStore, type RallyPoint } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import type { AltitudeFrame, PlannedHome, PlanVehicleProfile } from "@/lib/types";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { ValidationOptions } from "@/lib/validation/issue-types";
import { DEFAULT_PLAN_PROFILE, profileFromVehicleInfo } from "@/lib/mission/plan-profile";
import { useRtlReturnContext } from "@/hooks/use-rtl-return-context";
import { usePlanVehicleProfile } from "@/hooks/use-plan-profile";
import { useLegGroundProfiles } from "@/hooks/use-terrain-profile";
import { useSettingsStore } from "@/stores/settings-store";
import type { Jurisdiction } from "@/lib/jurisdiction";
import { regulatoryCeilingMetres } from "@/lib/validation/regulatory-ceiling";

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
  defaultSpeed: number;
  /** ArduPilot's home-centred circle fence radius, metres; null when none. */
  homeCircleRadiusM: number | null;
  plannedHome: PlannedHome | null;
  /** Profile the plan is validated for; null for a non-MAVLink target. */
  profile: PlanVehicleProfile | null;
  /** Operator jurisdiction; sets the advisory altitude ceiling (120 m when unset). */
  jurisdiction?: Jurisdiction | null;
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
    defaultSpeed: s.defaultSpeed,
    home: s.plannedHome
      ? { lat: s.plannedHome.lat, lon: s.plannedHome.lon, groundElevation: s.plannedHome.groundAmsl }
      : undefined,
    profile: s.profile ?? undefined,
    advisoryCeiling: regulatoryCeilingMetres(s.jurisdiction ?? null),
    homeCircleRadiusM:
      s.enabled && s.homeCircleRadiusM !== null && s.homeCircleRadiusM > 0 ? s.homeCircleRadiusM : undefined,
  };
}

/** True for a vehicle flying MSP missions, which the MAVLink profiles do not describe. */
function isMspTarget(protocol: DroneProtocol | null | undefined): boolean {
  const firmware = protocol?.getVehicleInfo()?.firmwareType;
  return firmware === "inav" || firmware === "betaflight";
}

/**
 * Read the current store snapshot, for non-React callers. `target` is the
 * vehicle the mission is meant for (its reported profile applies when the
 * plan has none); absent, the selected vehicle.
 */
export function readValidationOptionsSnapshot(target?: DroneProtocol | null): ValidationOptionsSnapshot {
  const g = useGeofenceStore.getState();
  const planner = usePlannerStore.getState();
  const mission = useMissionStore.getState();
  const vehicle = target === undefined ? selectSelectedProtocol(useDroneManager.getState()) : target;
  const profile =
    mission.vehicleProfile ??
    (isMspTarget(vehicle) ? null : profileFromVehicleInfo(vehicle?.getVehicleInfo()) ?? DEFAULT_PLAN_PROFILE);
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
    defaultFrame: planner.defaultFrame,
    defaultSpeed: planner.defaultSpeed,
    homeCircleRadiusM: g.homeCircleRadiusM,
    plannedHome: mission.plannedHome,
    profile,
    jurisdiction: useSettingsStore.getState().jurisdiction,
  };
}

/**
 * The selected ArduPilot vehicle's TERRAIN_ENABLE, kept with the link it was
 * read from; `undefined` until read, or for any other autopilot.
 */
function useTerrainEnabled(): boolean | undefined {
  const protocol = useDroneManager(selectSelectedProtocol);
  const firmware = protocol?.getVehicleInfo()?.firmwareType;
  const [read, setRead] = useState<{ protocol: DroneProtocol; value: boolean } | null>(null);
  useEffect(() => {
    if (!protocol || !firmware?.startsWith("ardupilot")) return;
    let live = true;
    protocol.getParameter("TERRAIN_ENABLE").then(
      (param) => {
        if (live && Number.isFinite(param.value)) setRead({ protocol, value: param.value !== 0 });
      },
      () => undefined,
    );
    return () => { live = false; };
  }, [protocol, firmware]);
  return read && read.protocol === protocol ? read.value : undefined;
}

/**
 * The selected ArduPlane's RTL_AUTOLAND, kept with the link it was read from;
 * `undefined` until read, or for any other vehicle.
 */
function useRtlAutoland(): number | undefined {
  const protocol = useDroneManager(selectSelectedProtocol);
  const firmware = protocol?.getVehicleInfo()?.firmwareType;
  const [read, setRead] = useState<{ protocol: DroneProtocol; value: number } | null>(null);
  useEffect(() => {
    if (!protocol || firmware !== "ardupilot-plane") return;
    let live = true;
    protocol.getParameter("RTL_AUTOLAND").then(
      (param) => {
        if (live && Number.isFinite(param.value)) setRead({ protocol, value: param.value });
      },
      () => undefined,
    );
    return () => { live = false; };
  }, [protocol, firmware]);
  return read && read.protocol === protocol ? read.value : undefined;
}

export function useValidationOptions(): ValidationOptions {
  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const maxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const minAltitude = useGeofenceStore((s) => s.minAltitude);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const homeCircleRadiusM = useGeofenceStore((s) => s.homeCircleRadiusM);
  const zones = useGeofenceStore((s) => s.zones);
  const rallyPoints = useRallyStore((s) => s.points);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const ownProfile = useMissionStore((s) => s.vehicleProfile);
  const waypoints = useMissionStore((s) => s.waypoints);
  const planProfile = usePlanVehicleProfile();
  // A plan with no profile of its own, on an MSP vehicle, gets no
  // MAVLink-autopilot rules.
  const mspTarget = isMspTarget(useDroneManager(selectSelectedProtocol));
  const profile = !ownProfile && mspTarget ? null : planProfile;
  const { rtlAltitude } = useRtlReturnContext();
  const terrainEnabled = useTerrainEnabled();
  const rtlAutoland = useRtlAutoland();
  const legGroundProfiles = useLegGroundProfiles(waypoints);
  const jurisdiction = useSettingsStore((s) => s.jurisdiction);

  return useMemo(
    () => ({
      ...buildValidationOptions({
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
        defaultSpeed,
        homeCircleRadiusM,
        plannedHome,
        profile,
        jurisdiction,
      }),
      rtlAltitude,
      terrainEnabled,
      rtlAutoland,
      legGroundProfiles,
    }),
    [
      enabled, fenceType, maxAltitude, minAltitude, polygonPoints, circleCenter, circleRadius, zones,
      rallyPoints, defaultFrame, defaultSpeed, homeCircleRadiusM, plannedHome, profile, jurisdiction, rtlAltitude,
      terrainEnabled, rtlAutoland, legGroundProfiles,
    ],
  );
}
