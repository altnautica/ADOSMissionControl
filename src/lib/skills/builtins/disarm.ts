/**
 * Disarm skill — disables motor output. One-shot, armed and on the ground
 * only, danger confirm.
 *
 * @module skills/builtins/disarm
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { refusalText } from "@/lib/hud/refusal";
import { vehicleLanded } from "../flight-facts";
import { disabledIfNoLink, pilotActionResult, REASON, specConfirm, viaPilot } from "./_shared";

export const disarmSkill: Skill = {
  id: "disarm",
  label: "skills.disarm",
  icon: "Power",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  confirm: specConfirm("disarm", "danger"),
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    if (ctx.armState === "disarmed") {
      return { kind: "disabled", reason: REASON.alreadyDisarmed };
    }
    // The spec's `armed_landed`: never disarm in the air (on some firmware
    // that cuts the motors). Kill is the in-flight stop.
    if (vehicleLanded(ctx.droneId) === false) return { kind: "disabled", reason: refusalText("airborne") };
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => (viaPilot(ctx) ? pilotActionResult("disarm") : ctx.protocol?.disarm()),
};
