/**
 * @license GPL-3.0-only
 *
 * Mission read-back comparison: what a vehicle may legitimately change (its
 * home slot, a frame echoed as its `_INT` twin, float32 rounding) still
 * matches; anything else does not.
 */

import { describe, it, expect } from "vitest";
import { missionReadBackMatches } from "@/lib/mission/mission-verify";
import type { MissionItem } from "@/lib/protocol/types";

function item(seq: number, over: Partial<MissionItem> = {}): MissionItem {
  return {
    seq, frame: 6, command: 16, current: 0, autocontinue: 1,
    param1: 0, param2: 0, param3: 0, param4: 0,
    x: 129700000 + seq, y: 775900000, z: 30, ...over,
  };
}

describe("missionReadBackMatches", () => {
  const sent = [item(0, { frame: 0, z: 0 }), item(1), item(2, { param1: 0.1 })];

  it("matches an echo with a new home slot, an INT twin frame and float32 rounding", () => {
    const echo = [item(0, { frame: 0, z: 912, x: 1 }), item(1, { frame: 3 }), item(2, { param1: Math.fround(0.1) })];
    expect(missionReadBackMatches(sent, echo, "ardupilot-copter")).toBe(true);
  });

  it("checks the home slot when the firmware has none", () => {
    const echo = [item(0, { frame: 0, z: 912 }), item(1), item(2, { param1: 0.1 })];
    expect(missionReadBackMatches(sent, echo, "px4")).toBe(false);
  });

  it("rejects a different count, command, position or altitude", () => {
    expect(missionReadBackMatches(sent, sent.slice(0, 2), "ardupilot-copter")).toBe(false);
    expect(missionReadBackMatches(sent, [sent[0], item(1, { command: 21 }), sent[2]], "ardupilot-copter")).toBe(false);
    expect(missionReadBackMatches(sent, [sent[0], item(1, { x: sent[1].x + 5 }), sent[2]], "ardupilot-copter")).toBe(false);
    expect(missionReadBackMatches(sent, [sent[0], item(1, { z: 30.5 }), sent[2]], "ardupilot-copter")).toBe(false);
  });
});
