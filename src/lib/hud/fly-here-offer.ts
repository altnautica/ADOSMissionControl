// Whether a surface offers "Fly here": the agent advertises the pilot's
// `goto` action in the pilot kind's `surface_ops`, and the pilot accepts it now
// only under ADOS control with the drone armed and flying. Whatever runs (a
// mission, a skill, an FC mode), the goto takes over after the hold. A stale
// pilot state offers nothing.

import type { PilotState } from "./cockpit-frames";
import { CHIP_STALE_AFTER_MS } from "./flight-state";

/** Whether the agent lists the `goto` action at all (the tip trigger). */
export function gotoAdvertised(p: Pick<PilotState, "surfaceOps"> | null): boolean {
  return p !== null && p.surfaceOps.includes("goto");
}

/** Whether the pilot accepts a surface `goto` now, from a pilot state
 *  `pilotAgeMs` old. */
export function flyHereOffered(p: PilotState | null, pilotAgeMs: number): boolean {
  return (
    p !== null &&
    pilotAgeMs < CHIP_STALE_AFTER_MS &&
    p.controlMode === "ados" &&
    gotoAdvertised(p) &&
    p.armed &&
    !p.landed
  );
}
