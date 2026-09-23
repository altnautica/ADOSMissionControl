/**
 * @module use-available-modes
 * @description The flight modes a drone's firmware offers, for React surfaces.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import type { UnifiedFlightMode } from "@/lib/protocol/types";

/**
 * The modes drone `droneId`'s firmware offers (see `liveAvailableModes` in
 * `@/lib/flight-mode`, which the set-mode skill gate uses), or null when the
 * GCS holds no connected flight controller for it. The array is stable while
 * the firmware handler is.
 */
export function useAvailableModes(droneId: string | null | undefined): UnifiedFlightMode[] | null {
  const protocol = useDroneManager((s) => (droneId ? s.drones.get(droneId)?.protocol ?? null : null));
  const handler = protocol?.isConnected ? protocol.getFirmwareHandler() : null;
  return useMemo(() => handler?.getAvailableModes() ?? null, [handler]);
}
