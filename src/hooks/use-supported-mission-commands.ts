/**
 * @module hooks/use-supported-mission-commands
 * @description The set of MAVLink mission-command ids the connected firmware
 * supports, or null when the firmware imposes no restriction. Used to hide
 * mission commands a firmware would reject (e.g. PX4 rejects the ArduPilot-only
 * NAV_SPLINE_WAYPOINT). Firmwares without a declared set return null so every
 * command stays offered (ArduPilot / iNav are unaffected).
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";

/**
 * Returns the supported mission-command id set for the selected drone's
 * firmware, or null when the firmware declares no restriction (show all).
 */
export function useSupportedMissionCommands(): Set<number> | null {
  // The handler is a stable per-connection object: subscribing to it re-renders
  // on a drone or firmware change, and the memo hands every render the same Set.
  const handler = useDroneManager((s) => s.getSelectedDrone()?.protocol?.getFirmwareHandler() ?? null);
  return useMemo(() => {
    const list = handler?.getSupportedMissionCommands?.();
    return list ? new Set(list) : null;
  }, [handler]);
}
