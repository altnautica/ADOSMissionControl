/**
 * @module lib/swarm/config-keys.test
 * @description The flocking gains cross three language boundaries as integer
 * percentages (TS surface -> YAML config -> Rust runtime) and are read back as
 * floats for display. A conversion that does not round-trip silently retunes a
 * flight-control weight on every read-modify-write of the settings page, so the
 * grid and its edges are pinned here.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import {
  SWARM_COMMAND_MODES,
  SWARM_FORMATIONS,
  SWARM_GAIN_MAX_PERCENT,
  SWARM_GAIN_MIN_PERCENT,
  gainFloatToPercent,
  gainPercentToFloat,
} from "../config-keys";

describe("swarm gain encoding", () => {
  it("reads a stored percent as the float weight the runtime applies", () => {
    expect(gainPercentToFloat(40)).toBe(0.4);
    expect(gainPercentToFloat(60)).toBe(0.6);
    expect(gainPercentToFloat(150)).toBe(1.5);
  });

  it("round-trips every percent on the 1% grid, including both bounds", () => {
    for (let p = SWARM_GAIN_MIN_PERCENT; p <= SWARM_GAIN_MAX_PERCENT; p++) {
      const gain = gainPercentToFloat(p);
      expect(gain).not.toBeNull();
      expect(gainFloatToPercent(gain as number)).toBe(p);
    }
  });

  it("renders two decimals rather than a float-division artefact", () => {
    // 45 / 100 is 0.45000000000000001 in IEEE double; a naive divide would
    // both display long and fail the round-trip above.
    expect((gainPercentToFloat(45) as number).toFixed(2)).toBe("0.45");
    expect(gainPercentToFloat(45)).toBe(0.45);
  });

  it("returns null for a key the config does not carry", () => {
    // A missing key must read "not set", never a fabricated 0.00.
    expect(gainPercentToFloat(undefined)).toBeNull();
    expect(gainPercentToFloat(null)).toBeNull();
    expect(gainPercentToFloat("40")).toBeNull();
    expect(gainPercentToFloat(Number.NaN)).toBeNull();
    expect(gainPercentToFloat(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("snaps a float back onto the integer grid the config field enforces", () => {
    expect(gainFloatToPercent(0.404)).toBe(40);
    expect(gainFloatToPercent(0.406)).toBe(41);
  });
});

describe("swarm closed value sets", () => {
  it("offers exactly the five built-in formations the agent accepts", () => {
    expect([...SWARM_FORMATIONS]).toEqual([
      "line",
      "column",
      "wedge",
      "grid",
      "circle",
    ]);
  });

  it("never offers a precedence level as a commandable mode", () => {
    // Hard separation and operator-direct are arbitration outcomes, not
    // things anyone selects; offering them would let the operator "command"
    // a mode the runtime can only enter on its own.
    expect([...SWARM_COMMAND_MODES]).toEqual(["hold", "flocking", "formation"]);
    expect(SWARM_COMMAND_MODES).not.toContain("hard-separation");
    expect(SWARM_COMMAND_MODES).not.toContain("operator");
  });
});
