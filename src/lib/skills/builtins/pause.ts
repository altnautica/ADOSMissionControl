/**
 * Pause / Hold skill — mission-aware. When the vehicle is flying a mission in
 * AUTO, pause holds the mission; otherwise it commands a LOITER hold at the
 * current position. One-shot, armed-only, no confirm. Requires autonomous nav.
 *
 * @module skills/builtins/pause
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink, REASON } from "./_shared";

export const pauseSkill: Skill = {
  id: "pause",
  label: "skills.pause",
  icon: "Pause",
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
  // Either branch's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => {
    if (!ctx.protocol) return;
    const missionAware = ctx.supports("supportsMissionUpload");
    if (missionAware && ctx.flightMode === "AUTO") {
      return ctx.protocol.pauseMission();
    }
    return ctx.protocol.setFlightMode("LOITER");
  },
};
