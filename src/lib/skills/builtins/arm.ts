/**
 * Arm skill — enables motor output. One-shot, disarmed-only, slide-to-confirm
 * (a long hold on a key or gamepad button). When the pre-flight checklist is
 * incomplete the sheet lists the failing items and needs an explicit override.
 *
 * @module skills/builtins/arm
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import {
  builtinConfirm,
  disabledIfNoLink,
  disabledUnlessDisarmed,
} from "./_shared";

export const armSkill: Skill = {
  id: "arm",
  label: "skills.arm",
  icon: "Power",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "disarmed",
  confirm: builtinConfirm("arm", "slide", "danger", { checklistAware: true }),
  getState: (ctx) => disabledIfNoLink(ctx) ?? disabledUnlessDisarmed(ctx) ?? { kind: "idle" },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal (e.g. a prearm failure) and spends nothing on it.
  activate: async (ctx) => ctx.protocol?.arm(),
};
