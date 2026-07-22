/**
 * Abort skill — commands an immediate landing. One-shot, any arm state, danger
 * confirm (ABORT phrase).
 *
 * @module skills/builtins/abort
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink } from "./_shared";

export const abortSkill: Skill = {
  id: "abort",
  label: "skills.abort",
  icon: "XOctagon",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "any",
  confirm: {
    title: "skills.abort.confirm.title",
    message: "skills.abort.confirm.message",
    confirmLabel: "skills.abort.confirm.button",
    variant: "danger",
    typedPhrase: "ABORT",
  },
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => ctx.protocol?.land(),
};
