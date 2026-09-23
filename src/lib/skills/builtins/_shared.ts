/**
 * Shared helpers for the built-in skills. Each built-in is a thin adapter over
 * an existing protocol call; these helpers express the common getState gates
 * (no FC link, wrong arm state, missing mode) and the i18n reason keys so the
 * 14 adapters stay short and consistent.
 *
 * @module skills/builtins/_shared
 * @license GPL-3.0-only
 */

import type { SkillContext, SkillState } from "../types";

/** i18n reason keys surfaced when a skill is disabled. */
export const REASON = {
  noFcLink: "skills.reason.noFcLink",
  alreadyArmed: "skills.reason.alreadyArmed",
  notArmed: "skills.reason.notArmed",
  alreadyDisarmed: "skills.reason.alreadyDisarmed",
  modeUnavailable: "skills.reason.modeUnavailable",
  noAutonomousNav: "skills.reason.noAutonomousNav",
} as const;

/** A drone has no live FC link when its protocol is absent. */
export function disabledIfNoLink(ctx: SkillContext): SkillState | null {
  if (!ctx.protocol) return { kind: "disabled", reason: REASON.noFcLink };
  return null;
}

/**
 * Disabled unless the vehicle is positively known to be disarmed: an armed
 * vehicle is already armed, and an unknown arm state means no heartbeat is
 * being read, so arming blind is refused as a missing link.
 */
export function disabledUnlessDisarmed(ctx: SkillContext): SkillState | null {
  if (ctx.armState === "armed") return { kind: "disabled", reason: REASON.alreadyArmed };
  if (ctx.armState === "unknown") return { kind: "disabled", reason: REASON.noFcLink };
  return null;
}
