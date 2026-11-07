/**
 * Take control skill: the ADOS pilot takes the vehicle back from the flight
 * controller (owner `fc_mode` → `pilot`, behind the centred-sticks gate).
 * Only offered on the pilot route. One-shot, armed-only, tap (shared spec).
 *
 * @module skills/builtins/take-control
 * @license GPL-3.0-only
 */

import { pilotStreamOpen } from "@/lib/input/pilot-stream";
import type { Skill } from "../types";
import { disabledIfNoLink, pilotActionResult, REASON } from "./_shared";

export const takeControlSkill: Skill = {
  id: "take_control",
  label: "skills.takeControl",
  icon: "Gamepad2",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    // Any control mode: taking control from the FC (owner fc_mode) is the
    // handover from a traditional start.
    if (!pilotStreamOpen(ctx.droneId)) return { kind: "disabled", reason: REASON.noPilot };
    if (ctx.armState === "disarmed") return { kind: "disabled", reason: REASON.notArmed };
    return { kind: "idle" };
  },
  activate: async () => pilotActionResult("take_control"),
};
