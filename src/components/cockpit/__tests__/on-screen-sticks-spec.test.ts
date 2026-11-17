/**
 * @license GPL-3.0-only
 *
 * The on-screen sticks show in the compact and expanded width classes
 * (`layout.json` `on_screen_sticks.classes`) and condition a pad with the
 * radial deadzone they are given (the operator's, by default the spec's
 * 0.08, `ds4.json` `conditioning.radial_deadzone`).
 */

import { describe, expect, it } from "vitest";

import ds4Spec from "@/lib/cockpit-spec/ds4.json";
import { STICK_CLASSES, padVector } from "@/components/cockpit/v2/OnScreenSticks";
import { useInputStore } from "@/stores/input-store";

describe("on-screen sticks spec values", () => {
  it("shows in the compact and expanded width classes only", () => {
    expect([...STICK_CLASSES]).toEqual(["compact", "expanded"]);
  });

  it("defaults to the spec's 0.08 radial deadzone", () => {
    expect(ds4Spec.conditioning.radial_deadzone).toBe(0.08);
    expect(useInputStore.getState().deadzone).toBe(ds4Spec.conditioning.radial_deadzone);
  });

  it("conditions a pad with the deadzone it is given", () => {
    const r = 100;
    // 7 px of a 100 px radius is inside 0.08; 9 px is outside it.
    expect(Math.hypot(...padVector(7, 0, r, 0.08))).toBe(0);
    expect(padVector(9, 0, r, 0.08)[0]).toBeGreaterThan(0);
    // ...and inside 0.2.
    expect(Math.hypot(...padVector(9, 0, r, 0.2))).toBe(0);
    const [x, y] = padVector(r, 0, r, 0.08);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(0, 5);
    // Up on the pad is positive y.
    expect(padVector(0, -r, r, 0.08)[1]).toBeCloseTo(1, 5);
  });
});
