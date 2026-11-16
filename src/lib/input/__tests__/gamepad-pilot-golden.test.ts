/**
 * @license GPL-3.0-only
 *
 * Golden vectors: the physical pad's pilot route conditions a stick exactly
 * as every other surface does (`cockpit-spec/stick-golden.json`). Each case's
 * raw sticks become the standard gamepad axes (0 left x, 1 left y, 2 right x,
 * 3 right y, y + down), go through the stick mode's axis map with Y inverted
 * as the poller reads them, then through `pilotAxes`.
 */

import { describe, expect, it } from "vitest";

import golden from "@/lib/cockpit-spec/stick-golden.json";
import { getMappingForMode, pilotAxes } from "../gamepad-axes";

type Case = (typeof golden.cases)[number] & { deadzone?: number };

describe("gamepad pilot route · shared golden vectors", () => {
  it.each((golden.cases as Case[]).map((c) => [`${c.mode} ${c.name}`, c] as const))("%s", (_name, c) => {
    const mode = c.mode === "mode1" ? 1 : 2;
    const m = getMappingForMode(mode);
    const pad = [c.raw.lx, c.raw.ly, c.raw.rx, c.raw.ry];
    const raw = { roll: pad[m.rollAxis], pitch: -pad[m.pitchAxis], thr: -pad[m.throttleAxis], yaw: pad[m.yawAxis] };
    const got = pilotAxes(raw, c.deadzone ?? golden.deadzone, mode);
    c.out.forEach((w, i) => expect(Math.abs(got[i] - w)).toBeLessThanOrEqual(golden.tolerance));
  });

  it("covers both stick modes", () => {
    const modes = new Set(golden.cases.map((c) => c.mode));
    expect([...modes].sort()).toEqual(["mode1", "mode2"]);
  });
});
