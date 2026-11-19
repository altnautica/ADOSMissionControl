/**
 * @module mock/demo-low-battery-energy.test
 * @description The demo pin for a low-battery return the estimate of the
 * way home asked for: the pilot frame carries the reserve, and the banner
 * names the charge the way home needs from the spec string.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { specText } from "@/lib/hud/spec-text";
import { DEMO_LOW_BATTERY_ENERGY_PIN, demoPilotWire } from "@/mock/mock-pilot-wire";

describe("demo energy-aware low-battery return", () => {
  it("parses the reserve and words the banner", () => {
    const p = parsePilotState(demoPilotWire({ armed: true, landed: false, ...DEMO_LOW_BATTERY_ENERGY_PIN }));
    expect(p?.batteryReserve).toEqual({ needPct: 52, basis: "energy", returnS: 248 });
    expect(p?.lowBatteryAction).toBe("rth");
    const b = p?.banner;
    expect(b?.textKey).toBe("pilot.banner.low_battery_rth_energy");
    expect(specText(b!.textKey, b!.args)).toBe("Battery 48% · need 52% to reach home · Returning in 10 s");
  });

  it("reads no reserve on the ground or from a malformed one", () => {
    expect(parsePilotState(demoPilotWire())?.batteryReserve).toBeNull();
    const odd = { battery_reserve: { need_pct: 52, basis: "guess", return_s: 248 } };
    expect(parsePilotState(demoPilotWire(odd))?.batteryReserve).toBeNull();
  });
});
