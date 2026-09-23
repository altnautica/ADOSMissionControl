/**
 * Arm skill — enables motor output. One-shot, disarmed-only, danger confirm
 * with the checklist-aware OVERRIDE escalation when the pre-flight checklist
 * is incomplete.
 *
 * @module skills/builtins/arm
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink, disabledUnlessDisarmed } from "./_shared";

export const armSkill: Skill = {
  id: "arm",
  label: "skills.arm",
  icon: "Power",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "disarmed",
  confirm: {
    title: "skills.arm.confirm.title",
    message: "skills.arm.confirm.message",
    confirmLabel: "skills.arm.confirm.button",
    variant: "danger",
    typedPhrase: "ARM",
    checklistAware: true,
  },
  getState: (ctx) => disabledIfNoLink(ctx) ?? disabledUnlessDisarmed(ctx) ?? { kind: "idle" },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal (e.g. a prearm failure) and spends nothing on it.
  activate: async (ctx) => ctx.protocol?.arm(),
};
