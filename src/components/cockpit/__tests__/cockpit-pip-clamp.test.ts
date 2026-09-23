import { describe, expect, it } from "vitest";

import { clampToBounds } from "@/components/cockpit/CockpitPipInset";

describe("clampToBounds (PiP inset placement)", () => {
  it("leaves an in-bounds position untouched", () => {
    // 160x120 inset well inside a 1200x800 container.
    expect(clampToBounds(1000, 650, 1200, 800, 160, 120)).toEqual({
      x: 1000,
      y: 650,
    });
  });

  it("re-clamps a position stranded by a shrunk container", () => {
    // A position valid in a 1200x800 container (max x=1040, y=680)...
    const wide = clampToBounds(1000, 650, 1200, 800, 160, 120);
    expect(wide).toEqual({ x: 1000, y: 650 });
    // ...is pulled back inside when the container shrinks to 640x480 (leaving
    // immersive mode / a window resize): max x = 640-160 = 480, y = 480-120 = 360.
    expect(clampToBounds(wide.x, wide.y, 640, 480, 160, 120)).toEqual({
      x: 480,
      y: 360,
    });
  });

  it("never goes negative when the inset is larger than the container", () => {
    // A container smaller than the inset clamps both axes to 0, never negative.
    expect(clampToBounds(500, 500, 100, 80, 160, 120)).toEqual({ x: 0, y: 0 });
  });

  it("floors a negative input at the top-left corner", () => {
    expect(clampToBounds(-40, -10, 640, 480, 160, 120)).toEqual({ x: 0, y: 0 });
  });
});
