/**
 * @module gps-origin-store
 * @description The EKF origin (GPS_GLOBAL_ORIGIN) per connected drone: the
 * geodetic point its LOCAL_POSITION_NED and the companion's local map
 * measure from. Keyed by drone id rather than held in the selected-drone
 * telemetry rings because the vehicle sends it only when the origin is set
 * (and on request), so a drone selected later must still have it. Cleared
 * when the drone's telemetry bridge is torn down.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { GpsOriginData } from "@/lib/types";

interface GpsOriginState {
  byDrone: Record<string, GpsOriginData>;
  setOrigin: (droneId: string, origin: GpsOriginData) => void;
  clear: (droneId: string) => void;
}

export const useGpsOriginStore = create<GpsOriginState>()((set) => ({
  byDrone: {},
  setOrigin: (droneId, origin) => set((s) => ({ byDrone: { ...s.byDrone, [droneId]: origin } })),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.byDrone)) return s;
      const byDrone = { ...s.byDrone };
      delete byDrone[droneId];
      return { byDrone };
    }),
}));
