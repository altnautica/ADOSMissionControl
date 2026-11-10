/**
 * Pause (brake) skill. On the ADOS pilot it brakes to a hold (and pauses an
 * FC mission). Without the pilot, an active mission is paused with
 * DO_PAUSE_CONTINUE, otherwise the vehicle holds in LOITER. One-shot,
 * armed-only, no confirm, and sent blind over a stale link (shared spec).
 *
 * @module skills/builtins/pause
 * @license GPL-3.0-only
 */

import type { Skill, SkillContext } from "../types";
import type { CommandResult } from "@/lib/protocol/types";
import { useMissionStateStore } from "@/lib/mission/mission-state";
import { refusalText } from "@/lib/hud/refusal";
import { fcFailsafeActive } from "../flight-facts";
import {
  disabledIfNoBlindLink,
  lastResortPath,
  pilotActionResult,
  REASON,
  viaPilot,
  withStaleLinkWarning,
} from "./_shared";

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
    const noLink = disabledIfNoBlindLink(ctx);
    if (noLink) return noLink;
    if (ctx.armState === "disarmed") {
      return { kind: "disabled", reason: REASON.notArmed };
    }
    if (inFailsafe(ctx)) return { kind: "disabled", reason: refusalText("failsafe") };
    return withStaleLinkWarning(ctx, { kind: "idle" });
  },
  // Either branch's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it. A pilot that gives no answer at all
  // hands the brake to the flight controller.
  activate: async (ctx) => {
    if (viaPilot(ctx)) return pilotActionResult("pause", undefined, () => fcPause(ctx));
    return fcPause(ctx);
  },
};

/** A failsafe return or landing is never paused, on any route. */
function inFailsafe(ctx: SkillContext): boolean {
  return fcFailsafeActive(ctx.droneId, ctx.flightMode, ctx.systemStatus);
}

/** The flight-controller brake: pause an active mission, else LOITER.
 *  Refused while the FC flies a failsafe: LOITER would cancel it. */
function fcPause(ctx: SkillContext): Promise<CommandResult> | undefined {
  const now = ctx.refresh?.() ?? ctx;
  if (inFailsafe(now)) {
    return Promise.resolve({ success: false, resultCode: 4, message: refusalText("failsafe") });
  }
  const path = lastResortPath(ctx);
  if (!path) return undefined;
  if (ctx.missionState === "active") {
    return path.pauseMission().then((r) => {
      if (r.success) useMissionStateStore.getState().observe(ctx.droneId, { apPause: true });
      return r;
    });
  }
  return path.setFlightMode("LOITER");
}
