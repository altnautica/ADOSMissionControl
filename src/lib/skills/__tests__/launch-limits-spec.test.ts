/**
 * The launch altitude range and default come from the shared cockpit spec
 * `layout.json` (`launch`), so every surface offers the same range and starts
 * at the same height, with no default go-to offset.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import layout from "@/lib/cockpit-spec/layout.json";
import { launchLimits } from "@/lib/cockpit/launch-spec";
import { takeoffSkill, TAKEOFF_ALTITUDE_M, parseTakeoffAltitude } from "@/lib/skills/builtins/takeoff";

describe("launch limits", () => {
  it("are 1 to 120 m, starting at 3 m", () => {
    expect([launchLimits.altMinM, launchLimits.altMaxM, launchLimits.altDefaultM]).toEqual([1, 120, 3]);
    expect([TAKEOFF_ALTITUDE_M.min, TAKEOFF_ALTITUDE_M.max, TAKEOFF_ALTITUDE_M.default]).toEqual([1, 120, 3]);
  });

  it("equal layout.json's launch block, with no default go-to offset", () => {
    expect(launchLimits).toEqual({
      altMinM: layout.launch.alt_min_m,
      altMaxM: layout.launch.alt_max_m,
      altDefaultM: layout.launch.alt_default_m,
      gotoDefault: null,
    });
  });

  it("drive the take-off stepper and its parser", () => {
    expect(TAKEOFF_ALTITUDE_M).toEqual({
      min: layout.launch.alt_min_m,
      max: layout.launch.alt_max_m,
      default: layout.launch.alt_default_m,
    });
    expect(takeoffSkill.confirm?.altitude).toMatchObject({
      defaultM: layout.launch.alt_default_m,
      minM: layout.launch.alt_min_m,
      maxM: layout.launch.alt_max_m,
    });
    expect(takeoffSkill.confirmValues?.({})).toEqual({ altitude: layout.launch.alt_default_m });
    expect(parseTakeoffAltitude(String(layout.launch.alt_min_m))).toBe(layout.launch.alt_min_m);
    expect(parseTakeoffAltitude(String(layout.launch.alt_min_m - 0.5))).toBeNull();
    expect(parseTakeoffAltitude(String(layout.launch.alt_max_m + 1))).toBeNull();
  });
});
