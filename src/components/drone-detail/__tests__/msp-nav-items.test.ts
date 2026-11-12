/**
 * Betaflight and iNav configure flight modes, sensors and the frame over MSP
 * (Aux Modes, their own setup panels); the MAVLink parameter panels for them
 * read ArduPilot parameters the board does not have. iNav's receiver and rate
 * panels are likewise Betaflight's or ArduPilot's, so they stay off iNav.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { FC_NAV_ITEMS } from "@/components/drone-detail/fc-nav-items";
import type { FirmwareType } from "@/lib/protocol/types";

function excluded(id: string, fw: FirmwareType): boolean {
  const item = FC_NAV_ITEMS.find((i) => i.id === id);
  expect(item, id).toBeDefined();
  return item!.excludeFirmware?.includes(fw) ?? false;
}

describe("MAVLink-only setup panels on MSP firmwares", () => {
  it.each(["modes", "sensors", "frame"])("%s is hidden on Betaflight and iNav", (id) => {
    expect(excluded(id, "betaflight")).toBe(true);
    expect(excluded(id, "inav")).toBe(true);
    expect(excluded(id, "ardupilot-copter")).toBe(false);
  });

  it.each(["receiver", "rate-profiles"])("%s is hidden on iNav and kept on Betaflight", (id) => {
    expect(excluded(id, "inav")).toBe(true);
    expect(excluded(id, "betaflight")).toBe(false);
  });

  it("Betaflight and iNav keep their MSP flight-mode panel", () => {
    expect(excluded("aux-modes", "betaflight")).toBe(false);
    expect(excluded("aux-modes", "inav")).toBe(false);
  });

  it("ArduPilot Outputs is hidden on MSP firmwares, which have Motors & ESC / Output Mapping", () => {
    expect(excluded("outputs", "betaflight")).toBe(true);
    expect(excluded("outputs", "inav")).toBe(true);
    expect(excluded("outputs", "px4")).toBe(false);
  });

  it("Betaflight has its own failsafe panel", () => {
    const item = FC_NAV_ITEMS.find((i) => i.id === "bf-failsafe");
    expect(item?.requiredCapability).toBe("supportsBetaflightConfig");
    expect(item?.section).toBe("Safety");
  });
});
