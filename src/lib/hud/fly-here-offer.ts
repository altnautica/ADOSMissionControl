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
//
// Neither: `reason` says why, worded by `refusal.<reason>`, so a long-press
// on the map can say it in a toast instead of opening a dialog. An unknown
// arm state (the pilot has no FC link) is possibly airborne: never `landed`.

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

export type FlyHereReason = "failsafe" | "landed" | "pilot_stale" | "control_mode" | "not_guided";

export interface FlyHereOffer {
  /** `pilot`: send the pilot's `goto`; `fc`: reposition the FC in GUIDED;
   *  null: no "Fly here" now. */
  route: "pilot" | "fc" | null;
  /** Why not, when `route` is null and a reason is known. */
  reason?: FlyHereReason;
}

/** Whether "Fly here" is offered now, from a pilot state `pilotAgeMs` old
 *  and the flight controller's own state, and why not. */
export function flyHereOffered(p: PilotState | null, pilotAgeMs: number, fc?: FlyHereFc | null): FlyHereOffer {
  const fresh = pilotAgeMs < CHIP_STALE_AFTER_MS;
  if (p !== null && fresh && p.controlMode === "ados" && gotoAdvertised(p) && p.armed === true && p.landed === false && !p.fcFailsafe) {
    return { route: "pilot" };
  }
  if (fc && fc.guided && fc.armed && !fc.landed) return { route: "fc" };
  if (p !== null && !fresh) return { route: null, reason: "pilot_stale" };
  if (p !== null) {
    if (p.fcFailsafe) return { route: null, reason: "failsafe" };
    if (p.armed === false || p.landed === true) return { route: null, reason: "landed" };
    if (!fc && gotoAdvertised(p) && p.controlMode !== "ados") return { route: null, reason: "control_mode" };
  }
  if (fc) {
    if (!fc.armed || fc.landed) return { route: null, reason: "landed" };
    if (!fc.guided) return { route: null, reason: "not_guided" };
  }
  return { route: null };
}
