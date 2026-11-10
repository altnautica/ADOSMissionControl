/**
 * The binding resolver: one slot can stand for a pair of skills whose meaning
 * flips with the vehicle's state. An `arm` binding fires `disarm` while the
 * vehicle is armed and known to be on the ground, and a `pause` binding fires `resume` while the mission is
 * paused (the mission state, never a flight-mode name). Every surface that
 * fires or labels a binding (keyboard, gamepad, skill picker, palette,
 * radial, tooltips) resolves through here so they all agree.
 *
 * @module skills/bound-skill
 * @license GPL-3.0-only
 */

import type { ArmState } from "@/lib/types";
import type { SkillContext } from "./types";
import { hasLandedSource, vehicleLanded } from "./flight-facts";

/** The context fields the resolver reads. */
export type BoundSkillContext = Pick<SkillContext, "missionState"> & { droneId?: string | null };

/** True while a mission is paused and a `pause` binding should resume it. */
export function isMissionPaused(ctx: BoundSkillContext): boolean {
  return ctx.missionState === "paused";
}

/** The skill a binding to `skillId` fires in the current vehicle state. */
export function resolveBoundSkillId(
  skillId: string,
  armState: ArmState,
  ctx: BoundSkillContext,
): string {
  // Disarm only on the ground: in the air, or with the landed state unknown,
  // the arm binding stays `arm`, which is disabled while armed, so the press
  // does nothing. Firmware with no landed state at all (MSP) flips to disarm,
  // as Disarm itself is not gated there.
  if (skillId === "arm" && armState === "armed") {
    if (!ctx.droneId) return "arm";
    return vehicleLanded(ctx.droneId) === true || !hasLandedSource(ctx.droneId) ? "disarm" : "arm";
  }
  if (skillId === "pause" && isMissionPaused(ctx)) return "resume";
  return skillId;
}
