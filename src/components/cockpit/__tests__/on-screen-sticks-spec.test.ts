/**
 * @license GPL-3.0-only
 *
 * The on-screen sticks show in the compact and expanded width classes
 * (`layout.json` `on_screen_sticks.classes`) and condition a pad with the
 * 0.08 radial deadzone (`ds4.json` `conditioning.radial_deadzone`).
 */

import { describe, expect, it } from "vitest";

import { STICK_CLASSES, STICK_DEADZONE, padVector } from "@/components/cockpit/v2/OnScreenSticks";

describe("on-screen sticks spec values", () => {
  it("shows in the compact and expanded width classes only", () => {
    expect([...STICK_CLASSES]).toEqual(["compact", "expanded"]);
  });

  it("uses the 0.08 radial deadzone", () => {
    expect(STICK_DEADZONE).toBe(0.08);
    const r = 100;
    // 7 px of a 100 px radius is inside the deadzone; 9 px is outside it.
    expect(Math.hypot(...padVector(7, 0, r))).toBe(0);
    expect(padVector(9, 0, r)[0]).toBeGreaterThan(0);
    const [x, y] = padVector(r, 0, r);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(0, 5);
    // Up on the pad is positive y.
    expect(padVector(0, -r, r)[1]).toBeCloseTo(1, 5);
  });
});
