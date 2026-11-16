/**
 * @license GPL-3.0-only
 *
 * Golden vectors: an on-screen pad dragged up flies forward (right pad) or
 * climbs (left pad), exactly as a controller stick pushed up does, with the
 * pilot's signs (pitch + forward, thr + climb, yaw + clockwise, roll + right).
 * Screen y grows downward, so "up" is a negative pointer offset.
 */

import { describe, expect, it } from "vitest";

import { onScreenAxes, padVector } from "@/components/cockpit/v2/OnScreenSticks";

const R = 60;
const UP: [number, number] = [0, -R];
const DOWN: [number, number] = [0, R];
const RIGHT: [number, number] = [R, 0];
const CENTRE: [number, number] = [0, 0];

/** Pilot axes for pointer offsets on the left and right pads (px from each pad's centre). */
function drag(left: [number, number], right: [number, number]): number[] {
  return onScreenAxes(padVector(left[0], left[1], R), padVector(right[0], right[1], R)).map((v) => v + 0);
}

describe("on-screen sticks golden vectors", () => {
  const golden: [string, [number, number], [number, number], number[]][] = [
    ["right pad up flies forward", CENTRE, UP, [0, 1, 0, 0]],
    ["right pad down flies back", CENTRE, DOWN, [0, -1, 0, 0]],
    ["left pad up climbs", UP, CENTRE, [0, 0, 1, 0]],
    ["left pad down descends", DOWN, CENTRE, [0, 0, -1, 0]],
    ["right pad right rolls right", CENTRE, RIGHT, [1, 0, 0, 0]],
    ["left pad right yaws clockwise", RIGHT, CENTRE, [0, 0, 0, 1]],
  ];
  it.each(golden)("%s", (_name, left, right, want) => {
    const got = drag(left, right);
    want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));
  });

  it("a released pad is centred", () => {
    expect(onScreenAxes(null, null)).toEqual([0, 0, 0, 0]);
  });
});
