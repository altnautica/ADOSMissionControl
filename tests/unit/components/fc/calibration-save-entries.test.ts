/**
 * What a calibration save writes to the vehicle. An RC channel the receiver
 * never reported must not be written with its inverted start values, and a
 * compass whose fit the flight controller rejected must not have its offsets
 * force-saved.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { rcCalibrationEntries } from "@/components/fc/calibration/rc-calibration-entries";
import { compassSaveEntries } from "@/components/fc/calibration/compass-save-entries";
import type { CompassResult } from "@/components/fc/calibration/calibration-types";

describe("rcCalibrationEntries", () => {
  it("writes only channels that moved during capture", () => {
    const captures = [
      { min: 1000, max: 2000, trim: 1500 },
      { min: 2200, max: 800, trim: 1500 }, // never reported
    ];
    const entries = rcCalibrationEntries(captures, new Map([["RC1_MIN", 1100]]));
    expect(entries.map((e) => e.name)).toEqual(["RC1_MIN", "RC1_MAX", "RC1_TRIM"]);
    expect(entries[0]).toEqual({ name: "RC1_MIN", value: 1000, oldValue: 1100 });
  });

  it("keeps the trim inside the captured endpoints", () => {
    const [, , trim] = rcCalibrationEntries([{ min: 1100, max: 1900, trim: 1000 }], new Map());
    expect(trim.value).toBe(1100);
  });
});

function fit(calStatus: number, ofsX: number): CompassResult {
  return {
    ofsX, ofsY: 2, ofsZ: 3, fitness: 5, calStatus,
    diagX: 1, diagY: 1, diagZ: 1, offdiagX: 0, offdiagY: 0, offdiagZ: 0,
    orientationConfidence: 1, oldOrientation: 0, newOrientation: 0, scaleFactor: 1,
  };
}

describe("compassSaveEntries", () => {
  it("writes the successful compass and skips a rejected fit", () => {
    const plan = compassSaveEntries(new Map([[0, fit(4, 10)], [1, fit(6, 999)]]), null);
    expect(plan.saved).toEqual([0]);
    expect(plan.skipped).toEqual([1]);
    expect(plan.entries.map((e) => e.name)).toEqual(["COMPASS_OFS_X", "COMPASS_OFS_Y", "COMPASS_OFS_Z"]);
    expect(plan.entries.some((e) => e.name.startsWith("COMPASS_OFS2"))).toBe(false);
  });

  it("writes nothing when no fit succeeded", () => {
    expect(compassSaveEntries(new Map([[0, fit(5, 1)]]), null).entries).toEqual([]);
  });
});
