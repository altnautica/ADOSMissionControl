/**
 * @module mock/demo-link
 * @description The link faults a demo session can switch on, shared by the
 * mock engine (which the demo controls drive) and the demo feeds that honour
 * them. A frozen link stops the engine's telemetry tick and the demo pilot
 * publisher, so the freshness-gated surfaces and the flight-state chip age
 * out the way they do on a dead radio. A blocked nav stream makes the demo
 * nav feed behave as if
 * `/api/v1/nav/stream` cannot be reached: nothing arrives until the fallback
 * delay passes, then the `nav/status` poll delivers at its reduced rate.
 * @license GPL-3.0-only
 */

let telemetryFrozen = false;
let navStreamBlockedAt: number | null = null;

/** Freeze (true) or resume (false) every demo telemetry publisher. */
export function setDemoTelemetryFrozen(frozen: boolean): void {
  telemetryFrozen = frozen;
}

/** Whether demo telemetry is frozen. */
export function demoTelemetryFrozen(): boolean {
  return telemetryFrozen;
}

/** Block (true) or restore (false) the demo nav stream. */
export function setDemoNavStreamBlocked(blocked: boolean, now: number = Date.now()): void {
  if (!blocked) navStreamBlockedAt = null;
  else if (navStreamBlockedAt === null) navStreamBlockedAt = now;
}

/** When the demo nav stream was blocked (browser clock, ms), or null. */
export function demoNavStreamBlockedAt(): number | null {
  return navStreamBlockedAt;
}
