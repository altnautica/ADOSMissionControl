/**
 * Disarm skill — disables motor output. One-shot, armed and known to be on the
 * ground only, danger confirm.
 *
 * @module skills/builtins/disarm
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { refusalText } from "@/lib/hud/refusal";
import { vehicleLanded } from "../flight-facts";
import { disabledIfNoLink, pilotActionResult, REASON, specConfirm, viaPilot } from "./_shared";

/** The spec's `armed_landed` landed half: why Disarm is refused now, or null
 *  while the vehicle is known to be on the ground. Never disarm in the air (on
 *  some firmware that cuts the motors), and an unknown landed state is refused
 *  like the air. Kill is the in-flight stop. */
function notLandedReason(droneId: string): string | null {
  const landed = vehicleLanded(droneId);
  if (landed === true) return null;
  return refusalText(landed === null ? "landed_unknown" : "not_landed");
}

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
    const why = notLandedReason(ctx.droneId);
    return why ? { kind: "disabled", reason: why } : { kind: "idle" };
  },
  // The landed gate is read again at the send, on every route. The vehicle's
  // answer goes back to the dispatcher, which surfaces a refusal and spends
  // nothing on it.
  activate: async (ctx) => {
    const why = notLandedReason(ctx.droneId);
    if (why) return { success: false, resultCode: 4, message: why };
    return viaPilot(ctx) ? pilotActionResult("disarm") : ctx.protocol?.disarm();
  },
};
