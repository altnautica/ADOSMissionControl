/**
 * The binding resolver: one slot can stand for a pair of skills whose meaning
 * flips with the vehicle's state. An `arm` binding fires `disarm` while the
 * vehicle is armed, and a `pause` binding fires `resume` while the mission is
 * paused (the C8 mission state, never a flight-mode name). Every surface that
 * fires or labels a binding (keyboard, gamepad, skill picker, palette,
 * radial, tooltips) resolves through here so they all agree.
 *
 * @module skills/bound-skill
 * @license GPL-3.0-only
 */

import type { ArmState } from "@/lib/types";
import type { SkillContext } from "./types";

/** The context fields the resolver reads. */
export type BoundSkillContext = Pick<SkillContext, "missionState">;

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
  if (skillId === "arm" && armState === "armed") return "disarm";
  if (skillId === "pause" && isMissionPaused(ctx)) return "resume";
  return skillId;
}
