/**
 * Land skill — commands a landing at the current position. One-shot, armed-
 * only, hold-to-confirm. Requires autonomous nav. A last-resort command: on a
 * stale link it stays fireable and is sent blind, with a stale-link warning.
 *
 * @module skills/builtins/land
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { noteCommandedMode } from "../flight-facts";
import { disabledIfNoLink, pilotActionResult, REASON, specConfirm, viaPilot } from "./_shared";

export const landSkill: Skill = {
  id: "land",
  label: "skills.land",
  icon: "ArrowDownToLine",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  requiresAutonomousNav: true,
  confirm: specConfirm("land", "danger"),
  getState: (ctx) => {
    // The shared spec disables Land on a stale link, with the reason.
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return ctx.linkStale ? { kind: "disabled", reason: REASON.linkStaleDisabled } : noLink;
    if (ctx.armState === "disarmed") {
      return { kind: "disabled", reason: REASON.notArmed };
    }
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => {
    noteCommandedMode(ctx.droneId, "LAND");
    return viaPilot(ctx) ? pilotActionResult("land") : ctx.protocol?.land();
  },
};
