// Whether a surface offers "Fly here", and through whom.
//
// Pilot route: the agent advertises the pilot's `goto` action in the pilot
// kind's `surface_ops`, and the pilot accepts it now: a fresh pilot state,
// ADOS control (outside `ados` the pilot refuses a goto with
// `control_mode`), the drone armed and flying, and no FC failsafe RTL or land
// (the pilot refuses with `failsafe`). Whatever runs (a mission, a skill, an
// FC mode), the goto takes over after the hold.
//
// FC route: otherwise, a flight controller in GUIDED, armed and flying takes
// a reposition straight from the surface.

import type { PilotState } from "./cockpit-frames";
import { CHIP_STALE_AFTER_MS } from "./flight-state";

/** Whether the agent lists the `goto` action at all (the tip trigger). */
export function gotoAdvertised(p: Pick<PilotState, "surfaceOps"> | null): boolean {
  return p !== null && p.surfaceOps.includes("goto");
}

/** What the surface knows of the flight controller itself. */
export interface FlyHereFc {
  guided: boolean;
  armed: boolean;
  landed: boolean;
}

export interface FlyHereOffer {
  /** `pilot`: send the pilot's `goto`; `fc`: reposition the FC in GUIDED;
   *  null: no "Fly here" now. */
  route: "pilot" | "fc" | null;
}

/** Whether "Fly here" is offered now, from a pilot state `pilotAgeMs` old
 *  and the flight controller's own state. */
export function flyHereOffered(p: PilotState | null, pilotAgeMs: number, fc?: FlyHereFc | null): FlyHereOffer {
  if (
    p !== null &&
    pilotAgeMs < CHIP_STALE_AFTER_MS &&
    p.controlMode === "ados" &&
    gotoAdvertised(p) &&
    p.armed &&
    !p.landed &&
    !p.fcFailsafe
  ) {
    return { route: "pilot" };
  }
  if (fc && fc.guided && fc.armed && !fc.landed) return { route: "fc" };
  return { route: null };
}
