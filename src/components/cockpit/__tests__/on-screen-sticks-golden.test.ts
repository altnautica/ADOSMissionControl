/**
 * @license GPL-3.0-only
 *
 * Golden vectors: the on-screen pads condition a touch exactly as every
 * other surface conditions a stick (`cockpit-spec/stick-golden.json`: raw
 * stick in, `[roll, pitch, thr, yaw]` out, both stick modes, the deadzone
 * edge), and a pad dragged up flies forward or climbs with the pilot's signs
 * (pitch + forward, thr + climb, yaw + clockwise, roll + right). Screen y
 * grows downward, so "up" is a negative pointer offset.
 */

import { describe, expect, it } from "vitest";

import golden from "@/lib/cockpit-spec/stick-golden.json";
import { onScreenAxes, padVector } from "@/components/cockpit/v2/OnScreenSticks";

const R = 60;
const DZ = golden.deadzone;

type Case = (typeof golden.cases)[number] & { deadzone?: number };

describe("on-screen sticks · shared golden vectors", () => {
  it.each((golden.cases as Case[]).map((c) => [`${c.mode} ${c.name}`, c] as const))("%s", (_name, c) => {
    const dz = c.deadzone ?? DZ;
    const left = padVector(c.raw.lx * R, c.raw.ly * R, R, dz);
    const right = padVector(c.raw.rx * R, c.raw.ry * R, R, dz);
    const got = onScreenAxes(left, right, c.mode === "mode1" ? 1 : 2);
    c.out.forEach((w, i) => expect(Math.abs(got[i] - w)).toBeLessThanOrEqual(golden.tolerance));
  });
});

describe("on-screen sticks · signs", () => {
  const UP: [number, number] = [0, -R];
  const DOWN: [number, number] = [0, R];
  const RIGHT: [number, number] = [R, 0];
  const CENTRE: [number, number] = [0, 0];
  const drag = (left: [number, number], right: [number, number]) =>
    onScreenAxes(padVector(left[0], left[1], R, DZ), padVector(right[0], right[1], R, DZ), 2).map((v) => v + 0);

  const cases: [string, [number, number], [number, number], number[]][] = [
    ["right pad up flies forward", CENTRE, UP, [0, 1, 0, 0]],
    ["right pad down flies back", CENTRE, DOWN, [0, -1, 0, 0]],
    ["left pad up climbs", UP, CENTRE, [0, 0, 1, 0]],
    ["left pad down descends", DOWN, CENTRE, [0, 0, -1, 0]],
    ["right pad right rolls right", CENTRE, RIGHT, [1, 0, 0, 0]],
    ["left pad right yaws clockwise", RIGHT, CENTRE, [0, 0, 0, 1]],
  ];
  it.each(cases)("%s (Mode 2)", (_name, left, right, want) => {
    const got = drag(left, right);
    want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));
  });

  it("in Mode 1 the left pad flies forward and the right pad climbs", () => {
    expect(onScreenAxes(padVector(0, -R, R, DZ), null, 1).map((v) => v + 0)).toEqual([0, 1, 0, 0]);
    expect(onScreenAxes(null, padVector(0, -R, R, DZ), 1).map((v) => v + 0)).toEqual([0, 0, 1, 0]);
  });

  it("a released pad is centred", () => {
    expect(onScreenAxes(null, null, 2)).toEqual([0, 0, 0, 0]);
    expect(onScreenAxes(null, null, 1)).toEqual([0, 0, 0, 0]);
  });
});
