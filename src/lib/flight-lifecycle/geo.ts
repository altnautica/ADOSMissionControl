/**
 * ID helper for the flight lifecycle state machine. Pure — no side effects,
 * no store access. Distance lives in `@/lib/geo/distance`.
 *
 * @module flight-lifecycle/geo
 */

export function cryptoRandomId(): string {
  // crypto.randomUUID is available in modern browsers and Node 19+.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `flt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
