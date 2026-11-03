import { describe, expect, it } from "vitest";

import {
  FOLLOW_MODE_FORGET_MS,
  bearing3,
  intervalBar,
  isFollowingMode,
  rangeScaleMax,
} from "@/lib/vision/follow-chrome";
import { camSwapPlan } from "@/lib/cockpit/cam-swap";
import type { StreamDescriptor } from "@/stores/video-streams-store";

describe("isFollowingMode", () => {
  const base = { ageMs: 100, installed: true, designated: false };
  it("is on for any reported phase other than idle", () => {
    expect(isFollowingMode({ ...base, phase: "following" })).toBe(true);
    expect(isFollowingMode({ ...base, phase: "lost" })).toBe(true);
    expect(isFollowingMode({ ...base, phase: "idle" })).toBe(false);
    expect(isFollowingMode({ ...base, phase: null })).toBe(false);
  });

  it("is on for a designated target only while the follow skill is installed", () => {
    expect(isFollowingMode({ ...base, phase: "idle", designated: true })).toBe(true);
    expect(
      isFollowingMode({ ...base, phase: null, designated: true, installed: false }),
    ).toBe(false);
  });

  it("steps aside once the last report is long gone", () => {
    expect(
      isFollowingMode({ ...base, phase: "coasting", ageMs: FOLLOW_MODE_FORGET_MS + 1 }),
    ).toBe(false);
  });
});

describe("range interval bar", () => {
  it("scales to max(20, ceil5(range + 2σ))", () => {
    expect(rangeScaleMax(10.2, 0.3)).toBe(20);
    expect(rangeScaleMax(21, 1)).toBe(25);
    expect(rangeScaleMax(25, 0)).toBe(25);
    expect(rangeScaleMax(30, null)).toBe(30);
  });

  it("places the filled segment and the tick as fractions of the track", () => {
    const bar = intervalBar(10, 0.5);
    expect(bar.maxM).toBe(20);
    expect(bar.lo).toBeCloseTo(0.45);
    expect(bar.hi).toBeCloseTo(0.55);
    expect(bar.tick).toBeCloseTo(0.5);
    expect(intervalBar(10, null).lo).toBeNull();
  });

  it("formats bearings as three digits in [0, 360)", () => {
    expect(bearing3(64)).toBe("064");
    expect(bearing3(359.6)).toBe("000");
    expect(bearing3(-10)).toBe("350");
  });
});

const leg = (id: string, role: string, kind: "concurrent" | "switchable" = "concurrent"): StreamDescriptor => ({
  id,
  index: 1,
  label: id,
  role,
  kind,
});

describe("camSwapPlan", () => {
  it("needs two concurrent legs, one a belly camera", () => {
    expect(camSwapPlan([leg("a", "eo")], "a", null)).toBeNull();
    expect(camSwapPlan([leg("a", "eo"), leg("b", "ir")], "a", null)).toBeNull();
    expect(camSwapPlan([leg("a", "eo"), leg("b", "down", "switchable")], "a", null)).toBeNull();
  });

  it("swaps the main and PiP legs", () => {
    const streams = [leg("a", "eo"), leg("b", "down"), leg("c", "ir")];
    expect(camSwapPlan(streams, "a", "c")).toEqual({ main: streams[2], pip: streams[0] });
    // No PiP: the belly leg comes to the main view.
    expect(camSwapPlan(streams, "a", null)).toEqual({ main: streams[1], pip: streams[0] });
    // Belly already main: the first other leg.
    expect(camSwapPlan(streams, "b", null)).toEqual({ main: streams[0], pip: streams[1] });
  });
});
