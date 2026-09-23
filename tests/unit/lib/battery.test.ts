/**
 * Battery sample semantics every surface reads through `@/lib/battery`:
 * an unestimated remaining is unknown, a whole-pack value in voltages[0] is
 * not a cell, and a cell count is never inferred from pack voltage.
 */

import { describe, it, expect } from "vitest";
import { knownRemainingPct, plausibleCellVoltages, resolveCellCount } from "@/lib/battery";

describe("knownRemainingPct", () => {
  it("reads -1 (not estimated) as unknown, not an empty pack", () => {
    expect(knownRemainingPct(-1)).toBeNull();
  });

  it("keeps a real 0% and a real reading", () => {
    expect(knownRemainingPct(0)).toBe(0);
    expect(knownRemainingPct(57)).toBe(57);
  });

  it("reads absent and non-finite values as unknown", () => {
    expect(knownRemainingPct(undefined)).toBeNull();
    expect(knownRemainingPct(null)).toBeNull();
    expect(knownRemainingPct(Number.NaN)).toBeNull();
  });
});

describe("cell voltages and count", () => {
  it("treats a whole-pack voltage in voltages[0] as no measured cells", () => {
    expect(plausibleCellVoltages([16.8])).toBeUndefined();
    expect(resolveCellCount([16.8], null)).toBeNull();
  });

  it("uses an independently known count (the MSP-reported cell count) for an unmeasured pack", () => {
    expect(resolveCellCount([16.8], 4)).toBe(4);
    expect(resolveCellCount(undefined, 6)).toBe(6);
  });

  it("prefers measured cells over a known count", () => {
    expect(resolveCellCount([4.1, 4.1, 4.0], 4)).toBe(3);
  });

  it("rejects a non-integer or zero known count", () => {
    expect(resolveCellCount(undefined, 0)).toBeNull();
    expect(resolveCellCount(undefined, 3.5)).toBeNull();
  });
});
