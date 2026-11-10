/**
 * The controller's Options button does what the controller spec (`ds4.json`)
 * binds it to: a tap fires the spec's action, held with the D-pad it steps
 * the profile instead, and the cockpit owns the Options button at the spec's
 * index so no skill can be bound over it.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import ds4 from "@/lib/cockpit-spec/ds4.json";
import { GestureEngine, SPEC_BINDINGS, WEB_BUTTON_INDEX, type Ds4Binding } from "@/lib/input/ds4-bindings";
import { COCKPIT_GAMEPAD_BUTTON, isReservedGamepadButton } from "@/lib/skills/chord";
import { effectiveBindings } from "@/stores/controls-store";

/** The spec file's own rows, read as written. */
const FILE_BINDINGS = ds4.bindings as Ds4Binding[];
const OPTIONS_TAP = FILE_BINDINGS.find((b) => b.control === "options" && b.with.length === 0 && b.gesture === "tap");

function run(steps: readonly (readonly string[])[]): string[] {
  const fired: string[] = [];
  const engine = new GestureEngine(effectiveBindings({ bindings: null }), {
    when: () => true,
    fire: (b) => fired.push(b.action),
  });
  steps.forEach((down, i) => engine.update((c) => down.includes(c), i * 100));
  engine.update(() => false, 10_000);
  return fired;
}

describe("Options button", () => {
  it("has a tap binding in the spec", () => {
    expect(OPTIONS_TAP?.action).toBe("quick_settings");
    expect(SPEC_BINDINGS).toContainEqual(OPTIONS_TAP);
  });

  it("fires the spec's binding on a tap", () => {
    expect(run([["options"], []])).toEqual([OPTIONS_TAP?.action]);
  });

  it("steps the profile, not the tap action, when held with the D-pad", () => {
    const chord = FILE_BINDINGS.find((b) => b.control === "dpad_right" && b.with.includes("options"));
    expect(run([["options"], ["options", "dpad_right"], ["options"], []])).toEqual([chord?.action]);
  });

  it("is a cockpit-owned button at the spec's index", () => {
    expect(COCKPIT_GAMEPAD_BUTTON.options).toBe(WEB_BUTTON_INDEX.options);
    expect(isReservedGamepadButton(WEB_BUTTON_INDEX.options)).toBe(true);
  });
});
