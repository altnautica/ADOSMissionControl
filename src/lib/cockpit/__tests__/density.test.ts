import { describe, expect, it } from "vitest";

import {
  COCKPIT_DENSITIES,
  DEFAULT_DENSITY,
  meetsDensity,
} from "@/lib/cockpit/density";

describe("cockpit density", () => {
  it("defaults to standard and lists the three modes in order", () => {
    expect(DEFAULT_DENSITY).toBe("standard");
    expect(COCKPIT_DENSITIES).toEqual(["minimal", "standard", "full"]);
    expect(COCKPIT_DENSITIES).toContain(DEFAULT_DENSITY);
  });

  it("admits a widget at its own density and every denser one", () => {
    expect(meetsDensity("standard", "standard")).toBe(true);
    expect(meetsDensity("standard", "full")).toBe(true);
    expect(meetsDensity("minimal", "minimal")).toBe(true);
    expect(meetsDensity("minimal", "full")).toBe(true);
  });

  it("thins a widget out below its density", () => {
    expect(meetsDensity("standard", "minimal")).toBe(false);
    expect(meetsDensity("full", "standard")).toBe(false);
    expect(meetsDensity("full", "minimal")).toBe(false);
  });
});
