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
 *   station commanded, and the drone accepted, is not a failsafe while the
 *   drone flies it; once the drone is seen leaving that mode, a later return
 *   is the flight controller's own again. Pause is refused during one, on the
 *   pilot route and the flight-controller route alike.
 * - **Landed**: the pilot's `landed` while its state is fresh, else the flight
 *   controller's own landed state (EXTENDED_SYS_STATE) while that is fresh.
 *   Unknown when neither says: a height above home cannot tell a low hover
 *   from a landing spot above home.
 * @license GPL-3.0-only
 */

import type { FlightMode } from "@/lib/types";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { isFresh } from "@/lib/telemetry/freshness";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

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

/** MAV_LANDED_STATE_ON_GROUND. */
export const MAV_LANDED_STATE_ON_GROUND = 1;
/** MAV_LANDED_STATE_IN_AIR, then TAKEOFF (3) and LANDING (4): all off the ground. */
const MAV_LANDED_STATE_IN_AIR = 2;
const MAV_LANDED_STATE_LANDING = 4;

/** A mode the drone accepted from this ground station, and when it was first
 *  seen flying it (null until then). */
interface CommandedMode {
  mode: FlightMode;
  seenAt: number | null;
}

/** The last accepted mode command per drone, until the drone leaves it. */
const commanded = new Map<string, CommandedMode>();

/** The flight controller's last EXTENDED_SYS_STATE landed state per drone. */
const fcLandedStates = new Map<string, { state: number; at: number }>();

/** Record a mode the drone accepted from this ground station (any route).
 *  When the selected drone's heartbeat already reports it, it counts as seen. */
export function noteCommandedMode(droneId: string, mode: FlightMode, now: number = Date.now()): void {
  commanded.set(droneId, { mode, seenAt: null });
  if (useDroneManager.getState().selectedDroneId === droneId) {
    observeFlightMode(droneId, useDroneStore.getState().flightMode, now);
  }
}

/** Record `mode` once the sent mode command is accepted. A refused or failed
 *  command is not recorded. No command sent (undefined) passes through. */
export function noteModeOnSuccess<R extends { success: boolean }>(
  droneId: string,
  mode: FlightMode,
  sent: Promise<R>,
): Promise<R>;
export function noteModeOnSuccess<R extends { success: boolean }>(
  droneId: string,
  mode: FlightMode,
  sent: Promise<R> | undefined,
): Promise<R> | undefined;
export function noteModeOnSuccess<R extends { success: boolean }>(
  droneId: string,
  mode: FlightMode,
  sent: Promise<R> | undefined,
): Promise<R> | undefined {
  return sent?.then((r) => {
    if (r.success) noteCommandedMode(droneId, mode);
    return r;
  });
}

/** The drone's heartbeat reports `mode`: a commanded mode is seen, or ended
 *  once the drone flies something else after having been seen in it. */
export function observeFlightMode(droneId: string, mode: FlightMode, now: number = Date.now()): void {
  const c = commanded.get(droneId);
  if (!c) return;
  if (c.mode === mode) {
    if (c.seenAt === null) c.seenAt = now;
  } else if (c.seenAt !== null) {
    commanded.delete(droneId);
  }
}

/** Record the flight controller's EXTENDED_SYS_STATE landed state. */
export function noteFcLandedState(droneId: string, landedState: number, at: number = Date.now()): void {
  fcLandedStates.set(droneId, { state: landedState, at });
}

/** Forget what is known of a drone that went away (removed or disconnected). */
export function forgetDrone(droneId: string): void {
  commanded.delete(droneId);
  fcLandedStates.delete(droneId);
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
  if (stamped && pilotFresh(stamped.receivedAt, now)) return stamped.data.fcFailsafe;
  if (systemStatus != null && systemStatus >= MAV_STATE_CRITICAL && systemStatus <= 8) return true;
  if (!RETURN_OR_LAND[flightMode]) return false;
  return commanded.get(droneId)?.mode !== flightMode;
}

/** On the ground: true or false when known, null when nothing says. */
export function vehicleLanded(droneId: string, now: number = Date.now()): boolean | null {
  const stamped = useNavStreamStore.getState().byDrone[droneId]?.pilot;
  if (stamped && pilotFresh(stamped.receivedAt, now)) return stamped.data.landed;
  const fc = fcLandedStates.get(droneId);
  if (!fc || !isFresh(fc.at, now)) return null;
  if (fc.state === MAV_LANDED_STATE_ON_GROUND) return true;
  if (fc.state >= MAV_LANDED_STATE_IN_AIR && fc.state <= MAV_LANDED_STATE_LANDING) return false;
  return null;
}
