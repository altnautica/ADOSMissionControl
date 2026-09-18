/**
 * iNav box IDs are PERMANENT IDs, not indices into a runtime list.
 *
 * `INAV_BOX_TO_MODE` / `MODE_TO_INAV_BOX` carried the wrong numbers, and the
 * consequence was not cosmetic: `mspActivateNavMode` drives the looked-up
 * box's AUX range directly, so "Return to home" engaged box 45 — NAV COURSE
 * HOLD, which holds heading and flies AWAY — while "Altitude hold" engaged
 * box 10, NAV RTH. Both `MSP_BOXIDS` and `MSP_MODE_RANGES` carry permanent
 * IDs, so the table is the only place the mapping can be wrong.
 *
 * Every number below is from iNav's `fc_msp_box.c` permanent-id list. These
 * assertions are the wire contract, not a restatement of the source: get one
 * wrong and a real aircraft flies the wrong mode.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import {
  INAV_BOX_TO_MODE,
  MODE_TO_INAV_BOX,
} from "@/lib/protocol/firmware/inav";

describe("iNav permanent box IDs", () => {
  it("maps return-to-home to box 10, not to a course-hold mode", () => {
    // The specific defect: RTL used to resolve to 45 (NAV COURSE HOLD).
    expect(MODE_TO_INAV_BOX.RTL).toBe(10);
    expect(INAV_BOX_TO_MODE[10]).toBe("RTL");
  });

  it("maps altitude hold to box 3, not to the RTH box", () => {
    // The mirror-image defect: ALT_HOLD used to resolve to 10, which is RTH.
    expect(MODE_TO_INAV_BOX.ALT_HOLD).toBe(3);
    expect(INAV_BOX_TO_MODE[3]).toBe("ALT_HOLD");
  });

  it("maps position hold to box 11", () => {
    expect(MODE_TO_INAV_BOX.POSHOLD).toBe(11);
    expect(INAV_BOX_TO_MODE[11]).toBe("POSHOLD");
  });

  it("maps the mission and launch boxes to their permanent IDs", () => {
    // NAV WP = 28, NAV LAUNCH = 36. Resume-mission used to engage 46
    // (MC BRAKING) and takeoff used to engage 47 (USER1).
    expect(INAV_BOX_TO_MODE[28]).toBe("MISSION");
    expect(INAV_BOX_TO_MODE[36]).toBe("TAKEOFF");
  });

  it("maps manual and cruise to their permanent IDs", () => {
    expect(MODE_TO_INAV_BOX.MANUAL).toBe(12);
    expect(INAV_BOX_TO_MODE[12]).toBe("MANUAL");
    expect(MODE_TO_INAV_BOX.CRUISE).toBe(53);
    expect(INAV_BOX_TO_MODE[53]).toBe("CRUISE");
  });

  it("never maps a flight mode onto a box that is not a flight mode", () => {
    // Box 0 is ARM. A mode resolving to it would arm the aircraft under a
    // mode-change label.
    expect(INAV_BOX_TO_MODE[0]).toBeUndefined();
    expect(Object.values(MODE_TO_INAV_BOX)).not.toContain(0);
  });

  it("round-trips every reverse entry through the forward table", () => {
    // A reverse entry pointing at a box the forward table reads as a
    // DIFFERENT mode is the exact shape of the original defect.
    for (const [mode, box] of Object.entries(MODE_TO_INAV_BOX)) {
      if (box === undefined) continue;
      expect(INAV_BOX_TO_MODE[box], `box ${box} for ${mode}`).toBe(mode);
    }
  });
});
