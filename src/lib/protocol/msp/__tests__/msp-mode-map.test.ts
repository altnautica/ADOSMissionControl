/**
 * @license GPL-3.0-only
 *
 * MSP box decoding decides whether a mode gives the pilot stick authority, and
 * the stick gate is an allow list: a mode it cannot classify must block the
 * override rather than open it. Betaflight and iNav number their boxes
 * differently, so decoding an iNav box against the Betaflight table names the
 * wrong mode — an autonomous navigation mode reading as ACRO is the case these
 * tests exist to prevent.
 */

import { describe, it, expect } from "vitest";

import { resolveActiveMode } from "../msp-mode-map";
import { STICK_AUTHORITY_MODES } from "@/lib/input/manual-control-gate";

/** Build the flag bytes (bit i = box index i) with the given indices set. */
function flagsFor(...indices: number[]): Uint8Array {
  const bytes = new Uint8Array(8);
  for (const i of indices) bytes[i >> 3] |= 1 << (i & 7);
  return bytes;
}

/**
 * Membership in the stick-authority allow list, by value. The gate is typed
 * over the drone-facing mode union while the decoder produces the protocol one,
 * and the two do not name exactly the same set, so this compares the way the
 * gate does at runtime.
 */
function givesStickAuthority(mode: string): boolean {
  return (STICK_AUTHORITY_MODES as ReadonlySet<string>).has(mode);
}

describe("resolveActiveMode - iNav box table", () => {
  // Box list as an iNav flight controller reports it: index in the array is
  // the bit position in the mode-flag word, the value is the permanent box id.
  // These are iNav PERMANENT box ids (fc_msp_box.c), which is what MSP_BOXIDS
  // carries. 10 is NAV RTH and 3 is NAV ALTHOLD — the table used to have those
  // two the other way round, so an aircraft flying an autonomous return home
  // decoded as ALT_HOLD, a stick-authority mode.
  const inavBoxIds = [0, 1, 2, 3, 10, 11, 12, 28, 36, 45, 46, 47, 53];

  it.each([
    [10, "RTL"],
    [11, "POSHOLD"],
    [2, "STABILIZE"],
    [3, "ALT_HOLD"],
    [12, "MANUAL"],
    [53, "CRUISE"],
    [28, "MISSION"],
    [36, "TAKEOFF"],
  ])("decodes iNav box %i as %s", (boxId, expected) => {
    const index = inavBoxIds.indexOf(boxId);
    const { mode } = resolveActiveMode(flagsFor(index), inavBoxIds, "inav");
    expect(mode).toBe(expected);
  });

  it("does not let an autonomous iNav mode pass the stick-authority gate", () => {
    const rtlIndex = inavBoxIds.indexOf(10);
    const { mode } = resolveActiveMode(flagsFor(rtlIndex), inavBoxIds, "inav");
    expect(givesStickAuthority(mode)).toBe(false);
  });

  it("reports armed from box id 0 alongside the mode", () => {
    const armIndex = inavBoxIds.indexOf(0);
    const rtlIndex = inavBoxIds.indexOf(10);
    const { mode, armed } = resolveActiveMode(
      flagsFor(armIndex, rtlIndex),
      inavBoxIds,
      "inav",
    );
    expect(armed).toBe(true);
    expect(mode).toBe("RTL");
  });

  it("prefers the autonomous mode when a stabilizing box is active with it", () => {
    const angleIndex = inavBoxIds.indexOf(1);
    const rtlIndex = inavBoxIds.indexOf(10);
    const { mode } = resolveActiveMode(
      flagsFor(angleIndex, rtlIndex),
      inavBoxIds,
      "inav",
    );
    expect(mode).toBe("RTL");
  });

  it("yields UNKNOWN, not ACRO, when no mapped box is active", () => {
    const { mode } = resolveActiveMode(flagsFor(), inavBoxIds, "inav");
    expect(mode).toBe("UNKNOWN");
    expect(givesStickAuthority(mode)).toBe(false);
  });

  it.each([[45], [46], [47]])(
    "yields UNKNOWN, never a flight mode, for iNav box %i",
    (boxId) => {
      // 45 NAV COURSE HOLD, 46 MC BRAKING and 47 USER1 are deliberately
      // unmapped: the table once claimed them as RTL / MISSION / TAKEOFF, so
      // "Return to home" engaged course-hold and flew AWAY from home.
      const { mode } = resolveActiveMode(flagsFor(0), [boxId], "inav");
      expect(mode).toBe("UNKNOWN");
      expect(givesStickAuthority(mode)).toBe(false);
    },
  );

  it("yields UNKNOWN for an active box the table does not cover", () => {
    const unmapped = [200];
    const { mode } = resolveActiveMode(flagsFor(0), unmapped, "inav");
    expect(mode).toBe("UNKNOWN");
  });
});

describe("resolveActiveMode - Betaflight box table", () => {
  // Betaflight PERMANENT ids (rc_modes.h boxId_e): ARM 0, ANGLE 1, HORIZON 2,
  // ALTHOLD 3, PREARM 36, GPS_RESCUE 46, ACRO_TRAINER 47.
  const bfBoxIds = [0, 1, 2, 3, 36, 46, 47];

  it.each([
    [1, "STABILIZE"],
    [2, "STABILIZE"],
    [3, "ALT_HOLD"],
    [46, "RTL"],
    [47, "ACRO"],
  ])("decodes Betaflight box %i as %s", (boxId, expected) => {
    const index = bfBoxIds.indexOf(boxId);
    const { mode } = resolveActiveMode(flagsFor(index), bfBoxIds, "betaflight");
    expect(mode).toBe(expected);
  });

  it("keeps ACRO as the Betaflight no-box-active default", () => {
    const { mode } = resolveActiveMode(flagsFor(), bfBoxIds, "betaflight");
    expect(mode).toBe("ACRO");
  });

  it("does not decode the PREARM box as RTL", () => {
    // 36 is PREARM on Betaflight, not a flight mode. The table used to map it
    // to RTL, so an armed-and-ready quad rendered as returning home.
    const { mode } = resolveActiveMode(flagsFor(0), [36], "betaflight");
    expect(mode).not.toBe("RTL");
  });

  it("never falls back to a stick-authority mode while GPS Rescue is active", () => {
    // GPS Rescue is 46. Against the old table it matched nothing and fell back
    // to ACRO, which IS in the stick-authority set — so a gamepad override was
    // permitted during an autonomous rescue.
    const index = bfBoxIds.indexOf(46);
    const { mode } = resolveActiveMode(flagsFor(index), bfBoxIds, "betaflight");
    expect(mode).toBe("RTL");
    expect(givesStickAuthority(mode)).toBe(false);
  });
});

describe("resolveActiveMode - unidentified firmware", () => {
  it("falls closed to UNKNOWN when the firmware is not yet known", () => {
    const { mode } = resolveActiveMode(flagsFor(), [0, 1, 2], undefined);
    expect(mode).toBe("UNKNOWN");
    expect(givesStickAuthority(mode)).toBe(false);
  });
});
