/**
 * @module scripts-in-fc-setup.test
 * @description Guards that the ArduPilot Lua Scripts feature lives inside the
 * Setup tab's flight-controller nav (a Programming panel), not as a standalone
 * top-level drone surface. Onboard Lua scripting is an FC feature, so it belongs
 * with the other FC configuration panels.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { DRONE_SURFACES } from "@/components/dashboard/node-detail/surfaces/drone";
import { FC_NAV_ITEMS } from "@/components/drone-detail/fc-nav-items";
import { FcPanelRouter } from "@/components/drone-detail/FcPanelRouter";

describe("Scripts moved from a top-level surface into Setup", () => {
  it("DRONE_SURFACES no longer exposes a standalone scripts surface", () => {
    expect(DRONE_SURFACES.some((s) => s.id === "scripts")).toBe(false);
  });

  it("FC_NAV_ITEMS has a scripts item excluded for px4/betaflight/inav, in Programming", () => {
    const scripts = FC_NAV_ITEMS.find((i) => i.id === "scripts");
    expect(scripts).toBeDefined();
    expect(scripts!.section).toBe("Programming");
    // Excluded on the non-ArduPilot firmwares (no Lua VM); shown for ArduPilot.
    expect(scripts!.excludeFirmware).toEqual(
      expect.arrayContaining(["px4", "betaflight", "inav"]),
    );
    // Matches the prevailing convention: no item excludes `unknown`, and it must
    // not exclude any ArduPilot variant.
    expect(scripts!.excludeFirmware).not.toContain("unknown");
    expect(
      (scripts!.excludeFirmware ?? []).some((fw) => fw.startsWith("ardupilot")),
    ).toBe(false);
  });

  it("FcPanelRouter dispatches the scripts panel (and null for an unknown id)", () => {
    expect(
      FcPanelRouter({ activePanel: "scripts", firmwareType: "ardupilot-copter", droneId: "d1", droneName: "Alpha" }),
    ).not.toBeNull();
    expect(
      FcPanelRouter({ activePanel: "not-a-real-panel", firmwareType: "ardupilot-copter", droneId: "d1", droneName: "Alpha" }),
    ).toBeNull();
  });
});
