/**
 * @license GPL-3.0-only
 *
 * The light bar shows the speed profile while the operator's sticks own the
 * vehicle (`ds4.json` `lightbar.profile_states`), with the state colours
 * (failsafe, low battery, RTH, mission, skill) above it. Other motion owners
 * that are not a mission or a skill show the plain pilot colour.
 */

import { describe, expect, it } from "vitest";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { lightbarColour, lightbarState } from "../ds4-feedback";

const pilot = (patch: Partial<PilotState>) => ({ owner: "pilot", profile: "normal", armed: true, ...patch }) as PilotState;
const ok = { lowBattery: false, linkLost: false };

describe("light bar per profile", () => {
  it.each([
    ["cine", "pilot_cine", [0x64, 0xff, 0xda]],
    ["normal", "pilot_normal", [0x29, 0x79, 0xff]],
    ["sport", "pilot_sport", [0xff, 0x6d, 0x00]],
  ] as const)("the sticks in %s show %s", (profile, state, rgb) => {
    expect(lightbarState(pilot({ profile }), ok)).toBe(state);
    expect(lightbarColour(state, 0)).toEqual(rgb);
  });

  it("each profile has its own colour", () => {
    const colours = (["pilot_cine", "pilot_normal", "pilot_sport"] as const).map((s) => lightbarColour(s, 0).join());
    expect(new Set(colours).size).toBe(3);
  });

  it("a stick owner without a reported profile shows the pilot colour", () => {
    expect(lightbarState(pilot({ profile: null }), ok)).toBe("pilot");
  });

  it.each(["goto", "swarm", "tuning"] as const)("owner %s shows the pilot colour", (owner) => {
    expect(lightbarState(pilot({ owner, profile: "sport" }), ok)).toBe("pilot");
  });

  it("state colours keep priority over the profile", () => {
    expect(lightbarState(pilot({ profile: "sport" }), { lowBattery: true, linkLost: false })).toBe("low_battery");
    expect(lightbarState(pilot({ profile: "sport" }), { lowBattery: false, linkLost: true })).toBe("failsafe");
    expect(lightbarState(pilot({ profile: "cine", fcModeName: "RTL" }), ok)).toBe("rth");
  });
});
