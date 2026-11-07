/**
 * Pause (brake) skill. On the ADOS pilot it brakes to a hold (and pauses an
 * FC mission). Without the pilot, an active mission (C8 state) is paused with
 * DO_PAUSE_CONTINUE, otherwise the vehicle holds in LOITER. One-shot,
 * armed-only, no confirm, and sent blind over a stale link (shared spec).
 *
 * @module skills/builtins/pause
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { useMissionStateStore } from "@/lib/mission/mission-state";
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
    return withStaleLinkWarning(ctx, { kind: "idle" });
  },
  // Either branch's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => {
    if (viaPilot(ctx)) return pilotActionResult("pause");
    const path = lastResortPath(ctx);
    if (!path) return;
    if (ctx.missionState === "active") {
      const r = await path.pauseMission();
      if (r.success) useMissionStateStore.getState().observe(ctx.droneId, { apPause: true });
      return r;
    }
    return path.setFlightMode("LOITER");
  },
};
