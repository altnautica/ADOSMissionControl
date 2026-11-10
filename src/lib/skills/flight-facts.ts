/**
 * @module skills/flight-facts
 * @description Two facts the safety built-ins gate on, read the same way on
 * every route:
 *
 * - **FC failsafe**: while the pilot's state is fresh, its own `fc_failsafe`
 *   flag says it (the pilot names the cause, and refuses Pause during one).
 *   Without a fresh pilot state: the flight controller is flying a return or
 *   landing it chose itself (a failsafe, or an RC-switch return), or its
 *   heartbeat reports CRITICAL/EMERGENCY. A return or landing this ground
 *   station commanded is not a failsafe. Pause is refused during one, on the
 *   pilot route and the flight-controller route alike.
 * - **Landed**: the pilot's `landed` while its state is fresh, else the FC's
 *   height above home. Unknown when neither is available.
 * @license GPL-3.0-only
 */

import type { FlightMode } from "@/lib/types";
import { PILOT_STALE_MS, useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { freshOnly } from "@/lib/telemetry/freshness";

/** FC modes that fly a return or a landing on their own. */
const RETURN_OR_LAND: Partial<Record<FlightMode, true>> = {
  RTL: true,
  SMART_RTL: true,
  LAND: true,
  QRTL: true,
  QLAND: true,
  LOITER_TO_QLAND: true,
  AUTOLAND: true,
};

/** MAV_STATE_CRITICAL and above (EMERGENCY, POWEROFF, FLIGHT_TERMINATION). */
const MAV_STATE_CRITICAL = 5;

/** Below this height above home (m) the FC side reads as on the ground. */
const GROUND_HEIGHT_M = 1;

/** The last FC mode this ground station asked for, per drone. */
const commanded = new Map<string, FlightMode>();

/** Record a mode this ground station asked the drone for (any route). */
export function noteCommandedMode(droneId: string, mode: FlightMode): void {
  commanded.set(droneId, mode);
}

/** Forget every recorded mode (tests). */
export function resetCommandedModes(): void {
  commanded.clear();
}

/** True while the FC flies a failsafe: the fresh pilot's `fcFailsafe` flag
 *  when there is one, else a return or landing nobody here asked for, or a
 *  heartbeat in a critical state. */
export function fcFailsafeActive(
  droneId: string,
  flightMode: FlightMode,
  systemStatus: number | null | undefined,
  now: number = Date.now(),
): boolean {
  const stamped = useNavStreamStore.getState().byDrone[droneId]?.pilot;
  if (stamped && now - stamped.receivedAt < PILOT_STALE_MS) return stamped.data.fcFailsafe;
  if (systemStatus != null && systemStatus >= MAV_STATE_CRITICAL && systemStatus <= 8) return true;
  if (!RETURN_OR_LAND[flightMode]) return false;
  return commanded.get(droneId) !== flightMode;
}

/** On the ground: true or false when known, null when nothing says. */
export function vehicleLanded(droneId: string, now: number = Date.now()): boolean | null {
  const stamped = useNavStreamStore.getState().byDrone[droneId]?.pilot;
  if (stamped && now - stamped.receivedAt <= PILOT_STALE_MS) return stamped.data.landed;
  const pos = freshOnly(useTelemetryStore.getState().position.latest(), now);
  if (pos?.relativeAlt === undefined) return null;
  return pos.relativeAlt < GROUND_HEIGHT_M;
}
