/**
 * The built-in skills' confirm sheets and refusal reasons are the shared
 * cockpit spec's words, so every surface asks and refuses alike: each title,
 * message, button label and reason key resolves in the spec.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { hasSpecString } from "@/lib/cockpit/spec-strings";
import { armSkill } from "../builtins/arm";
import { disarmSkill } from "../builtins/disarm";
import { killSkill } from "../builtins/kill";
import { landSkill } from "../builtins/land";
import { rthSkill } from "../builtins/rth";
import { takeoffSkill } from "../builtins/takeoff";
import { modeChangeConfirm, REASON } from "../builtins/_shared";

describe("built-in confirm text is the spec's", () => {
  it.each([armSkill, disarmSkill, killSkill, landSkill, rthSkill, takeoffSkill])("$id", (skill) => {
    const c = skill.confirm;
    if (!c) return;
    expect([c.title, c.message, c.confirmLabel].filter((k) => !hasSpecString(k))).toEqual([]);
  });

  it("labels each button with the spec's word for the built-in", () => {
    expect([armSkill, disarmSkill, killSkill, landSkill, rthSkill, takeoffSkill].map((s) => s.confirm?.confirmLabel)).toEqual([
      armSkill.confirm && "builtin.short.arm",
      disarmSkill.confirm && "builtin.short.disarm",
      killSkill.confirm && "confirm.kill.button",
      landSkill.confirm && "builtin.short.land",
      rthSkill.confirm && "pilot.link_loss_action.rth",
      takeoffSkill.confirm && "builtin.short.takeoff",
    ]);
  });

  it("a mode change", () => {
    const c = modeChangeConfirm("RTL")!;
    expect([c.title, c.message, c.confirmLabel].filter((k) => !hasSpecString(k))).toEqual([]);
    expect(c.confirmLabel).toBe("confirm.mode.button");
  });
});

describe("refusal reasons are the spec's", () => {
  it("every reason key resolves in the spec", () => {
    expect(Object.values(REASON).filter((k) => !hasSpecString(k))).toEqual([]);
  });
});
