/**
 * @module hold-reason-no-vantage.test
 * @description The pilot's vantage-goal hold reads in the spec's words on the
 * flight-state chip ("No clear view"), never as the raw reason key.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import cases from "@/lib/hud/fixtures/chip-cases.json";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { chipFacts, flightStateChip } from "@/lib/hud/flight-state";

describe("flight-state chip: no-vantage hold", () => {
  it("names the hold No clear view", () => {
    const c = cases.find((k) => k.name === "skill_no_vantage_hold");
    expect(c).toBeDefined();
    const pilot = parsePilotState(c!.input.pilot);
    expect(pilot?.holdReason).toBe("no-vantage");
    const view = flightStateChip(chipFacts(pilot!, 0, { homeDistM: null, modeDetail: null, completeAgeMs: null }));
    const lines = view.secondary.map((l) => l.text);
    expect(lines).toContain("No clear view");
    expect(lines.join(" ")).not.toMatch(/no[ -]vantage/);
  });
});
