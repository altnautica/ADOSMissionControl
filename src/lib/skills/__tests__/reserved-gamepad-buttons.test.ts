/**
 * Every control the controller spec binds belongs to the cockpit: a skill
 * bound to one would fire alongside the cockpit's own action (Cross opening
 * the picker and arming, Circle in the stop chord sending return home). No
 * path binds a skill to one.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";
import { SPEC_BINDINGS, WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { isReservedGamepadButton } from "@/lib/skills/chord";
import { useSettingsStore } from "@/stores/settings-store";

describe("cockpit-owned gamepad buttons", () => {
  beforeEach(() => {
    const { activeLoadoutId, resetLoadoutToDefaults } = useSettingsStore.getState();
    resetLoadoutToDefaults(activeLoadoutId);
  });

  it("reserves every control the controller spec binds", () => {
    const bound = new Set(
      SPEC_BINDINGS.filter((b) => b.action !== "none").flatMap((b) => [b.control, ...b.with]),
    );
    for (const control of ["cross", "circle", "square", "triangle", "l2", "r2", "l3", "r3", "ps"]) {
      expect(bound.has(control)).toBe(true);
    }
    for (const control of bound) {
      const index = WEB_BUTTON_INDEX[control];
      if (typeof index === "number") expect(isReservedGamepadButton(index), control).toBe(true);
    }
  });

  it("never binds a skill slot to a face button", () => {
    const { activeLoadoutId, setSlotGamepadButton } = useSettingsStore.getState();
    setSlotGamepadButton(activeLoadoutId, 0, WEB_BUTTON_INDEX.cross);
    setSlotGamepadButton(activeLoadoutId, 1, WEB_BUTTON_INDEX.circle);
    const slots = useSettingsStore.getState().loadouts[activeLoadoutId].slots;
    expect(slots[0].gamepadButton).toBeNull();
    expect(slots[1].gamepadButton).toBeNull();
  });
});
