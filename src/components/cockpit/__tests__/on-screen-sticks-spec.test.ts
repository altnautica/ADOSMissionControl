/**
 * @license GPL-3.0-only
 *
 * The on-screen sticks read their width classes from `layout.json` and their
 * deadzone from `ds4.json` conditioning.
 */

import { describe, expect, it } from "vitest";

import ds4Spec from "@/lib/cockpit-spec/ds4.json";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { STICK_CLASSES, STICK_DEADZONE, padVector } from "@/components/cockpit/v2/OnScreenSticks";

describe("on-screen sticks spec values", () => {
  it("shows in the layout spec's width classes", () => {
    expect(STICK_CLASSES).toEqual(layoutSpec.on_screen_sticks.classes);
  });

  it("uses the ds4 conditioning deadzone", () => {
    expect(STICK_DEADZONE).toBe(ds4Spec.conditioning.radial_deadzone);
    const r = 100;
    const inside = STICK_DEADZONE * r * 0.9;
    expect(Math.hypot(...padVector(inside, 0, r))).toBe(0);
    const [x] = padVector(r, 0, r);
    expect(x).toBeCloseTo(1, 5);
  });
});
