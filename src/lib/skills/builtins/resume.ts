/**
 * Resume skill. On the ADOS pilot it resumes (a paused FC mission goes back to
 * AUTO). Without the pilot it continues a paused mission (C8 state) with
 * DO_PAUSE_CONTINUE. One-shot, armed-only, tap (shared spec).
 *
 * @module skills/builtins/resume
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { useMissionStateStore } from "@/lib/mission/mission-state";
import { disabledIfNoLink, pilotActionResult, REASON, viaPilot } from "./_shared";

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
    if (!viaPilot(ctx) && ctx.missionState !== "paused") {
      return { kind: "disabled", reason: REASON.noPausedMission };
    }
    return { kind: "idle" };
  },
  activate: async (ctx) => {
    if (viaPilot(ctx)) return pilotActionResult("resume");
    if (!ctx.protocol || ctx.missionState !== "paused") return;
    const r = await ctx.protocol.resumeMission();
    if (r.success) useMissionStateStore.getState().observe(ctx.droneId, { apPause: false });
    return r;
  },
};
