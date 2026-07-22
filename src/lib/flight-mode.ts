/**
 * Runtime narrowing for flight-mode strings.
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

/** Every mode name that maps cleanly onto the `FlightMode` union. */
export const KNOWN_FLIGHT_MODES: ReadonlySet<string> = new Set<FlightMode>([
  "STABILIZE",
  "ALT_HOLD",
  "LOITER",
  "GUIDED",
  "AUTO",
  "RTL",
  "LAND",
  "MANUAL",
  "ACRO",
  "FBWA",
  "FBWB",
  "CRUISE",
  "TRAINING",
  "CIRCLE",
  "AUTOTUNE",
  "QSTABILIZE",
  "QHOVER",
  "QLOITER",
  "QLAND",
  "QRTL",
  "QAUTOTUNE",
  "QACRO",
  "AVOID_ADSB",
  "THERMAL",
  "POSHOLD",
  "BRAKE",
  "SMART_RTL",
  "DRIFT",
  "SPORT",
  "FLIP",
  "THROW",
  "FLOWHOLD",
  "FOLLOW",
  "ZIGZAG",
  "SYSTEMID",
  "HELI_AUTOROTATE",
  "AUTO_RTL",
  "TAKEOFF",
  "LOITER_TO_QLAND",
]);

/** Narrow a mode name to a `FlightMode`, or null when it is not one. */
export function asFlightMode(value: unknown): FlightMode | null {
  if (typeof value !== "string") return null;
  return KNOWN_FLIGHT_MODES.has(value) ? (value as FlightMode) : null;
}
