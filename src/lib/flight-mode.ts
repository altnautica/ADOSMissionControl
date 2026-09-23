/**
 * Runtime narrowing for flight-mode strings, and the one source of the modes a
 * live flight controller offers.
 *
 * Mode names arrive as free-form strings — from a heartbeat decode, from an
 * agent's telemetry snapshot — and have to be narrowed before they can be
 * treated as a `FlightMode`. A name outside the union is reported as unknown
 * rather than coerced into a neighbouring mode, so a caller decides what to do
 * with an unrecognised vehicle state instead of silently mislabelling it.
 *
 * @module flight-mode
 * @license GPL-3.0-only
 */

import type { FlightMode } from "@/lib/types";
import type { DroneProtocol, UnifiedFlightMode } from "@/lib/protocol/types";

/**
 * The mode table of `protocol`'s firmware handler: what the mode selector
 * offers, the Flight Modes panel assigns, and the set-mode skill gate accepts.
 * Null when there is no connected flight controller, or it has not identified
 * its firmware yet.
 */
export function liveAvailableModes(protocol: DroneProtocol | null | undefined): UnifiedFlightMode[] | null {
  if (!protocol?.isConnected) return null;
  return protocol.getFirmwareHandler()?.getAvailableModes() ?? null;
}

/**
 * Every mode name that maps cleanly onto the `FlightMode` union.
 *
 * `FlightMode` IS `UnifiedFlightMode`, so this set must list every member of
 * that union or a real vehicle mode narrows to null and the caller renders a
 * stale one. Keep it in step with `protocol/types/enums.ts`; the test asserts
 * a representative mode from every firmware family.
 */
export const KNOWN_FLIGHT_MODES: ReadonlySet<string> = new Set<FlightMode>([
  // Common
  "STABILIZE",
  "ACRO",
  "ALT_HOLD",
  "AUTO",
  "GUIDED",
  "LOITER",
  "RTL",
  "LAND",
  "CIRCLE",
  "POSHOLD",
  "AUTOTUNE",
  "MANUAL",
  // ArduPlane
  "TRAINING",
  "FBWA",
  "FBWB",
  "CRUISE",
  "AVOID_ADSB",
  "THERMAL",
  "QSTABILIZE",
  "QHOVER",
  "QLOITER",
  "QLAND",
  "QRTL",
  "QAUTOTUNE",
  "QACRO",
  "LOITER_TO_QLAND",
  "AUTOLAND",
  // ArduCopter
  "DRIFT",
  "SPORT",
  "FLIP",
  "THROW",
  "BRAKE",
  "SMART_RTL",
  "FLOWHOLD",
  "FOLLOW",
  "ZIGZAG",
  "SYSTEMID",
  "HELI_AUTOROTATE",
  "AUTO_RTL",
  "GUIDED_NOGPS",
  "TURTLE",
  // ArduRover
  "STEERING",
  "HOLD",
  "SIMPLE",
  "DOCK",
  // ArduSub
  "SURFACE",
  "MOTOR_DETECT",
  "SURFTRAK",
  // PX4
  "OFFBOARD",
  "RATTITUDE",
  "MISSION",
  "TAKEOFF",
  "FOLLOW_ME",
  "ORBIT",
  "READY",
  "PRECLAND",
  "VTOL_TAKEOFF",
  // Generic
  "UNKNOWN",
]);

/** Narrow a mode name to a `FlightMode`, or null when it is not one. */
export function asFlightMode(value: unknown): FlightMode | null {
  if (typeof value !== "string") return null;
  return KNOWN_FLIGHT_MODES.has(value) ? (value as FlightMode) : null;
}
