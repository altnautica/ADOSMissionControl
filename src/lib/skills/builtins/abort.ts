/**
 * Abort skill — commands an immediate landing. One-shot, any arm state,
 * hold-to-confirm.
 *
 * @module skills/builtins/abort
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { builtinConfirm, disabledIfNoLink } from "./_shared";

export const abortSkill: Skill = {
  id: "abort",
  label: "skills.abort",
  icon: "XOctagon",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "any",
  confirm: builtinConfirm("abort", "hold", "danger"),
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => ctx.protocol?.land(),
};
