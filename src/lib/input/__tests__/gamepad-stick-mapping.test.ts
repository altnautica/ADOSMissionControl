/**
 * @license GPL-3.0-only
 *
 * Which physical stick each axis index belongs to is the difference between a
 * pitch input and a throttle command, so the two TX-mode mappings are pinned
 * against the documented stick-mode table rather than left to the reader.
 */

import { describe, it, expect } from "vitest";

import { getMappingForMode } from "../gamepad-poller";

/**
 * Standard gamepad axis layout, which is what the mapping indices refer to:
 * left stick is axes 0 and 1, right stick is axes 2 and 3, X before Y.
 */
const LEFT_X = 0;
const LEFT_Y = 1;
const RIGHT_X = 2;
const RIGHT_Y = 3;

/** Which stick an axis index sits on. */
function stickOf(axis: number): "left" | "right" {
  return axis === LEFT_X || axis === LEFT_Y ? "left" : "right";
}

// The documented layout, matching the stick-mode table the RCMAP detection
// uses for the same modes:
//
//   Mode | Left stick      | Right stick
//   1    | Yaw + Pitch     | Roll + Throttle
//   2    | Yaw + Throttle  | Roll + Pitch
describe("stick mode mappings", () => {
  it("puts mode 2 yaw and throttle on the left stick, roll and pitch on the right", () => {
    const m = getMappingForMode(2);
    expect(stickOf(m.yawAxis)).toBe("left");
    expect(stickOf(m.throttleAxis)).toBe("left");
    expect(stickOf(m.rollAxis)).toBe("right");
    expect(stickOf(m.pitchAxis)).toBe("right");
  });

  it("puts mode 1 yaw and pitch on the left stick, roll and throttle on the right", () => {
    const m = getMappingForMode(1);
    expect(stickOf(m.yawAxis)).toBe("left");
    expect(stickOf(m.pitchAxis)).toBe("left");
    expect(stickOf(m.rollAxis)).toBe("right");
    expect(stickOf(m.throttleAxis)).toBe("right");
  });

  it("keeps roll and yaw on the horizontal axes and pitch and throttle on the vertical ones", () => {
    for (const mode of [1, 2] as const) {
      const m = getMappingForMode(mode);
      expect([LEFT_X, RIGHT_X]).toContain(m.rollAxis);
      expect([LEFT_X, RIGHT_X]).toContain(m.yawAxis);
      expect([LEFT_Y, RIGHT_Y]).toContain(m.pitchAxis);
      expect([LEFT_Y, RIGHT_Y]).toContain(m.throttleAxis);
    }
  });

  it("differs between the two modes only by swapping pitch and throttle", () => {
    expect(getMappingForMode(1).pitchAxis).toBe(getMappingForMode(2).throttleAxis);
    expect(getMappingForMode(1).throttleAxis).toBe(getMappingForMode(2).pitchAxis);
    expect(getMappingForMode(1).rollAxis).toBe(getMappingForMode(2).rollAxis);
    expect(getMappingForMode(1).yawAxis).toBe(getMappingForMode(2).yawAxis);
  });

  it("reports the mode it was asked for", () => {
    expect(getMappingForMode(1).txMode).toBe(1);
    expect(getMappingForMode(2).txMode).toBe(2);
  });
});
