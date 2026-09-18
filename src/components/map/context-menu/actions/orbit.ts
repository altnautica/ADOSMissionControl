/**
 * @module map/context-menu/actions/orbit
 * @description Orbit action handler. Invoked from the orbit configuration
 * sub-panel when the operator confirms radius and direction.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { MenuPosition, MenuReport } from "../types";

interface OrbitArgs {
  protocol: DroneProtocol | null;
  menuPos: MenuPosition;
  radius: number;
  clockwise: boolean;
  relativeAlt: number | undefined;
  report: MenuReport;
}

export async function handleOrbitConfirmed({
  protocol,
  menuPos,
  radius,
  clockwise,
  relativeAlt,
  report,
}: OrbitArgs): Promise<void> {
  if (!protocol?.orbit) {
    report("This firmware does not support orbit", "error");
    return;
  }
  const signedRadius = clockwise ? radius : -radius;
  // Ack-tracked COMMAND_INT: the handler used to discard the result, so an
  // orbit the vehicle refused reported nothing at all.
  const result = await protocol.orbit(
    signedRadius,
    2,
    2,
    menuPos.lat,
    menuPos.lon,
    relativeAlt ?? 20,
  );
  report(
    result.success
      ? `Orbiting at ${Math.round(radius)} m`
      : `Orbit failed: ${result.message}`,
    result.success ? "success" : "error",
  );
}
