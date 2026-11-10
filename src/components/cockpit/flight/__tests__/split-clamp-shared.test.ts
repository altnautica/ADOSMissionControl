/**
 * @license GPL-3.0-only
 *
 * The Split divider has one definition (`lib/cockpit/views`): the screen's
 * grid and pointer mapping clamp a ratio exactly as the view store does,
 * inside 0.3–0.7.
 */

import { afterEach, describe, expect, it } from "vitest";

import { SPLIT_DIVIDER, clampSplit, useCockpitViewStore } from "@/lib/cockpit/views";
import * as gridModule from "../flight-grid";

const DRONE = "split-clamp";
const RATIOS = [-1, 0, 0.1, 0.29, 0.3, 0.42, 0.5, 0.7, 0.71, 0.95, 2, Number.NaN];

afterEach(() => useCockpitViewStore.setState({ splitByDrone: {} }));

describe("one Split divider definition", () => {
  it("is not redefined by the flight grid", () => {
    expect(gridModule).not.toHaveProperty("SPLIT_DIVIDER");
    expect(gridModule).not.toHaveProperty("clampSplit");
  });

  it("uses the spec's limits", () => {
    expect([SPLIT_DIVIDER.min, SPLIT_DIVIDER.default, SPLIT_DIVIDER.max]).toEqual([0.3, 0.5, 0.7]);
  });

  it("clamps the screen's ratio as the store does", () => {
    for (const r of RATIOS) {
      useCockpitViewStore.getState().setSplit(DRONE, r);
      const stored = useCockpitViewStore.getState().splitByDrone[DRONE];
      const grid = gridModule.flightGrid({ width: 1280, height: 800, widthClass: "expanded", splitRatio: r });
      expect(grid.split, String(r)).toBe(stored);
      expect(stored, String(r)).toBe(clampSplit(r));
      expect(stored).toBeGreaterThanOrEqual(0.3);
      expect(stored).toBeLessThanOrEqual(0.7);
      // The pointer at that share of the slot maps back to the same ratio.
      expect(gridModule.splitFromPointer(r * 1280, grid), String(r)).toBeCloseTo(Number.isNaN(r) ? 0.5 : stored, 9);
    }
  });
});
