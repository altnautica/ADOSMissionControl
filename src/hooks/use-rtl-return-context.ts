/**
 * @module use-rtl-return-context
 * @description The two datums the RTL return-leg terrain checks need, read
 * from the connected vehicle rather than assumed:
 *
 * - `home`: the telemetry home position with the terrain sampled under that
 *   exact point. A pattern or plan whose first waypoint is away from the
 *   launch site must not have its relative altitudes resolved against that
 *   waypoint's ground.
 * - `rtlAltitude`: the vehicle's configured return altitude in metres above
 *   home (ArduCopter `RTL_ALT`, ArduPlane `ALT_HOLD_RTL`, PX4
 *   `RTL_RETURN_ALT`).
 *
 * Either is `undefined` until it is known; the checks then report themselves
 * unchecked instead of using a guessed value.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { FlightPlanOptions } from "@/lib/simulation-utils";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { getElevation } from "@/lib/terrain/terrain-provider";
import { readReturnAltitude } from "@/components/map/context-menu/actions/markers";

export interface RtlReturnContext {
  /** Launch point with the terrain elevation (metres MSL) sampled under it. */
  home?: { lat: number; lon: number; groundElevation: number };
  /** Configured return altitude, metres above home. */
  rtlAltitude?: number;
}

/** The selected vehicle's configured return altitude, metres above home. */
function useReturnAltitude(): number | undefined {
  const protocol = useDroneManager(selectSelectedProtocol);
  // The return altitude, kept with the link it was read from.
  const [returnAlt, setReturnAlt] = useState<{ protocol: DroneProtocol; value: number } | null>(null);
  useEffect(() => {
    if (!protocol) return;
    let live = true;
    void readReturnAltitude(protocol).then((value) => {
      if (live && value !== null) setReturnAlt({ protocol, value });
    });
    return () => { live = false; };
  }, [protocol]);
  return returnAlt && returnAlt.protocol === protocol ? returnAlt.value : undefined;
}

export function useRtlReturnContext(): RtlReturnContext {
  const homeSample = useTelemetryStore((s) => s.homePosition.latest());
  const homeLat = homeSample?.lat;
  const homeLon = homeSample?.lon;
  const rtlAltitude = useReturnAltitude();

  // Terrain under the telemetry home, kept with the exact point it was sampled at.
  const [homeTerrain, setHomeTerrain] = useState<{ lat: number; lon: number; elevation: number } | null>(null);
  useEffect(() => {
    if (homeLat === undefined || homeLon === undefined) return;
    const controller = new AbortController();
    void getElevation(homeLat, homeLon, controller.signal).then((elevation) => {
      if (!controller.signal.aborted && elevation !== null) {
        setHomeTerrain({ lat: homeLat, lon: homeLon, elevation });
      }
    });
    return () => controller.abort();
  }, [homeLat, homeLon]);

  return useMemo(() => {
    const home = homeTerrain && homeTerrain.lat === homeLat && homeTerrain.lon === homeLon
      ? { lat: homeTerrain.lat, lon: homeTerrain.lon, groundElevation: homeTerrain.elevation }
      : undefined;
    return { home, rtlAltitude };
  }, [homeTerrain, homeLat, homeLon, rtlAltitude]);
}

/**
 * Launch point and return altitude for flight-plan estimates (simulation,
 * mission stats): the selected vehicle's home and configured return altitude,
 * each `undefined` until known so the plan falls back to its own defaults.
 */
export function useFlightPlanOptions(): FlightPlanOptions {
  const homeSample = useTelemetryStore((s) => s.homePosition.latest());
  const homeLat = homeSample?.lat;
  const homeLon = homeSample?.lon;
  const rtlAltM = useReturnAltitude();
  return useMemo(
    () => ({
      home: homeLat !== undefined && homeLon !== undefined ? { lat: homeLat, lon: homeLon } : undefined,
      rtlAltM,
    }),
    [homeLat, homeLon, rtlAltM],
  );
}
