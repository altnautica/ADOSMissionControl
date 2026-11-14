/**
 * @module sensors/flow-orient-yaw.test
 * @description FLOW_ORIENT_YAW validation: centidegrees, -17999..18000, step
 * 10, the legacy 0..7 meaning flagged.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { FLOW_ORIENT_YAW_PRESETS, legacyYawCdeg, validateFlowOrientYaw } from "../flow-orient-yaw";

describe("validateFlowOrientYaw", () => {
  it.each([0, 10, 9000, -9000, 18000, -17990, 4500])("accepts %i", (v) => {
    expect(validateFlowOrientYaw(v)).toEqual({ valid: true, issue: null, degrees: v / 100 });
  });

  it.each([18010, 36000, -18000, -20000])("rejects %i as out of range", (v) => {
    expect(validateFlowOrientYaw(v)).toMatchObject({ valid: false, issue: "out_of_range" });
  });

  it.each([5, 8, 4505, -17999, 9001])("rejects %i as off the 10 cdeg step", (v) => {
    const r = validateFlowOrientYaw(v);
    expect(r.valid).toBe(false);
    expect(r.issue).toBe(v >= 1 && v <= 7 ? "legacy" : "not_step");
  });

  it.each([1, 2, 3, 4, 6, 7])("flags %i as the old 45° step value ArduPilot reads as centidegrees", (v) => {
    expect(validateFlowOrientYaw(v)).toEqual({ valid: false, issue: "legacy", degrees: v / 100 });
  });

  it("rejects a non-number", () => {
    expect(validateFlowOrientYaw(Number.NaN)).toMatchObject({ valid: false, issue: "not_number" });
  });

  it("offers the straight, reversed and sideways presets, all valid", () => {
    expect([...FLOW_ORIENT_YAW_PRESETS]).toEqual([0, 18000, 9000, -9000]);
    for (const v of FLOW_ORIENT_YAW_PRESETS) expect(validateFlowOrientYaw(v).valid).toBe(true);
  });
});

describe("legacyYawCdeg", () => {
  it.each([[1, 4500], [2, 9000], [3, 13500], [4, 18000], [5, -13500], [6, -9000], [7, -4500]])(
    "old step %i means %i centidegrees",
    (step, cdeg) => {
      expect(legacyYawCdeg(step)).toBe(cdeg);
      expect(validateFlowOrientYaw(cdeg).valid).toBe(true);
    },
  );
});
