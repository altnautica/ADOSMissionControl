/**
 * Land skill — commands a landing at the current position. One-shot, armed-
 * only, hold-to-confirm. Requires autonomous nav.
 *
 * @module skills/builtins/land
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { builtinConfirm, disabledIfNoLink, REASON } from "./_shared";

export const landSkill: Skill = {
  id: "land",
  label: "skills.land",
  icon: "ArrowDownToLine",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  requiresAutonomousNav: true,
  confirm: builtinConfirm("land", "hold", "danger"),
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    if (ctx.armState === "disarmed") {
      return { kind: "disabled", reason: REASON.notArmed };
    }
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => ctx.protocol?.land(),
};
