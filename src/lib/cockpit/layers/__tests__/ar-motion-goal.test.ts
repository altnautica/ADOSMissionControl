/**
 * The AR motion goal ring keeps the blocked colour while the way is blocked,
 * as the path does: from the pilot's avoid state, else from the state the
 * agent gave the camera's path.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import arFixture from "../fixtures/ar-frame.json";
import { layoutAr, type ArLayoutOptions } from "@/lib/hud/ar-layout";
import { parseArFrame, type ArCamera } from "@/lib/hud/cockpit-frames";
import { DrawOpBuffer } from "@/lib/hud/layer-layout";
import tokens from "@/lib/cockpit-spec/tokens.json";

const frame = parseArFrame(arFixture)!;
const cam: ArCamera = frame.cameras.main;
const rect = { x: 0, y: 0, w: 1280, h: 720 };

function goalColour(avoid: ArLayoutOptions["avoid"], c: ArCamera = cam): string | null {
  const buf = new DrawOpBuffer();
  layoutAr(c, rect, { level: "full", groups: { route: true, motion: true }, mission: frame.mission, avoid, showLoaded: true }, buf);
  return buf.ops.slice(0, buf.n).find((o) => o.k === "fgoal")?.color ?? null;
}

describe("AR motion goal", () => {
  it("rings the goal in the blocked colour while the pilot reports blocked", () => {
    expect(goalColour("blocked")).toBe(tokens.state.blocked);
    expect(goalColour("clear")).not.toBe(tokens.state.blocked);
  });

  it("falls back to the agent's path state without a pilot state", () => {
    const blockedPath: ArCamera = {
      ...cam,
      items: cam.items.map((i) => (i.t === "fpath" ? { ...i, state: "blocked" as const } : i)),
    };
    expect(goalColour(null, blockedPath)).toBe(tokens.state.blocked);
    expect(goalColour(null)).not.toBe(tokens.state.blocked);
  });
});
