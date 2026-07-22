/**
 * Resume skill — mission-aware. When a mission was paused (LOITER after AUTO),
 * resume continues it; otherwise it returns the vehicle to AUTO. One-shot,
 * armed-only, no confirm. Requires autonomous nav.
 *
 * @module skills/builtins/resume
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink, REASON } from "./_shared";

export const resumeSkill: Skill = {
  id: "resume",
  label: "skills.resume",
  icon: "Play",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  requiresAutonomousNav: true,
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    if (ctx.armState === "disarmed") {
      return { kind: "disabled", reason: REASON.notArmed };
    }
    return { kind: "idle" };
  },
  activate: async (ctx) => {
    if (!ctx.protocol) return;
    const missionAware = ctx.supports("supportsMissionUpload");
    const resumingMission =
      missionAware &&
      ctx.flightMode === "LOITER" &&
      ctx.previousMode === "AUTO";
    // Either branch's answer goes back to the dispatcher, which surfaces
    // a refusal and spends nothing on it.
    if (resumingMission) {
      return ctx.protocol.resumeMission();
    }
    return ctx.protocol.setFlightMode("AUTO");
  },
};
