import { describe, expect, it } from "vitest";

import { parseSimClock, simClockLabel } from "./sim-clock";

describe("sim clock badge", () => {
  it("shows only for a pilot on a simulator's clock", () => {
    expect(parseSimClock(undefined)).toBeNull();
    expect(parseSimClock({ source: "wall" })).toBeNull();
    expect(parseSimClock({ source: "sim", speed: 3, lag_ms: 4, sim_ns: 1 })).toEqual({ speed: 3, lagMs: 4 });
  });

  it("labels the speed", () => {
    expect(simClockLabel({ speed: 3, lagMs: null })).toBe("SIM ×3");
    expect(simClockLabel({ speed: 0.5, lagMs: null })).toBe("SIM ×0.5");
    expect(simClockLabel({ speed: 1, lagMs: null })).toBe("SIM ×1");
    expect(simClockLabel({ speed: 0, lagMs: null })).toBe("SIM ×max");
    expect(simClockLabel({ speed: null, lagMs: null })).toBe("SIM");
  });
});
