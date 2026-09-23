"use client";

import { useDroneStore } from "@/stores/drone-store";
import { useClockTick } from "@/lib/agent/freshness";
import { deriveHudStatus } from "@/lib/hud-readings";
import type { FlightMode } from "@/lib/types";

/**
 * The selected drone's flight mode, or null when no live heartbeat backs it.
 *
 * drone-store keeps the last mode after the link goes quiet and holds a
 * placeholder between a drone switch and that drone's first heartbeat, so a
 * raw read shows a mode the aircraft may not be in. This is the same heartbeat
 * gate the HUD applies, re-evaluated on the shared 1 Hz clock so the reading
 * clears once the heartbeat ages out.
 */
export function useLiveFlightMode(): FlightMode | null {
  const flightMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  useClockTick();
  return deriveHudStatus({}, { armState, flightMode, lastHeartbeat }).mode;
}
