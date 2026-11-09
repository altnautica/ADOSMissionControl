/**
 * The bottom row's AGL: the ADOS pilot's height above ground while its state
 * is fresh, else the downward rangefinder, else the terrain report.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { bottomRowValues, SENSOR_DOWN, type BottomRowInputs } from "../bottom-row";

const base: BottomRowInputs = {
  position: null,
  vfr: null,
  home: null,
  rangefinder: { currentDistance: 350, minDistance: 20, maxDistance: 1000, orientation: SENSOR_DOWN },
  terrain: { currentHeight: 9 },
  pilotAglM: null,
};

describe("bottom row AGL", () => {
  it("reads the pilot's agl_m when it has one", () => {
    expect(bottomRowValues({ ...base, pilotAglM: 4.2, pilotAglSource: "rangefinder" }).aglM).toBe(4.2);
  });

  it("falls back to the rangefinder, then the terrain report", () => {
    expect(bottomRowValues(base).aglM).toBe(3.5);
    expect(bottomRowValues({ ...base, rangefinder: null }).aglM).toBe(9);
  });

  it("never shows the pilot's height above home as AGL", () => {
    const home = { ...base, pilotAglM: 60, pilotAglSource: "home" };
    expect(bottomRowValues(home).aglM).toBe(3.5);
    expect(bottomRowValues({ ...home, rangefinder: null }).aglM).toBe(9);
    expect(bottomRowValues({ ...home, rangefinder: null, terrain: null }).aglM).toBeNull();
  });
});
