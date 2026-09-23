/**
 * @module map/context-menu/actions/orbit
 * @description Orbit action handler. Invoked from the orbit configuration
 * sub-panel when the operator confirms radius and direction. MAV_CMD_DO_ORBIT
 * is a PX4 command (ArduCopter has no handler for it), so the menu offers the
 * item only on PX4.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { MenuPosition, MenuReport } from "../types";

/** ORBIT_YAW_BEHAVIOUR_HOLD_FRONT_TO_CIRCLE_CENTER: nose (and camera) on the
 * clicked point of interest. */
const ORBIT_YAW_FRONT_TO_CENTER = 0;
/** DO_ORBIT param2 velocity; 2 m/s tangential. */
const ORBIT_VELOCITY_MS = 2;

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
    ORBIT_VELOCITY_MS,
    ORBIT_YAW_FRONT_TO_CENTER,
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
