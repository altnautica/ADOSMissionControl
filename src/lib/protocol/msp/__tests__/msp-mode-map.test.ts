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

/** Build a mode-flag word with the given box-list indices set. */
function flagsFor(...indices: number[]): number {
  let n = 0;
  for (const i of indices) n |= 1 << i;
  return n >>> 0;
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
  const inavBoxIds = [0, 1, 2, 10, 11, 12, 28, 45, 46, 47];

  it.each([
    [45, "RTL"],
    [11, "POSHOLD"],
    [2, "STABILIZE"],
    [10, "ALT_HOLD"],
    [12, "LOITER"],
    [28, "CRUISE"],
    [46, "MISSION"],
    [47, "TAKEOFF"],
  ])("decodes iNav box %i as %s", (boxId, expected) => {
    const index = inavBoxIds.indexOf(boxId);
    const { mode } = resolveActiveMode(flagsFor(index), inavBoxIds, "inav");
    expect(mode).toBe(expected);
  });

  it("does not let an autonomous iNav mode pass the stick-authority gate", () => {
    const rtlIndex = inavBoxIds.indexOf(45);
    const { mode } = resolveActiveMode(flagsFor(rtlIndex), inavBoxIds, "inav");
    expect(givesStickAuthority(mode)).toBe(false);
  });

  it("reports armed from box id 0 alongside the mode", () => {
    const armIndex = inavBoxIds.indexOf(0);
    const rtlIndex = inavBoxIds.indexOf(45);
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
    const rtlIndex = inavBoxIds.indexOf(45);
    const { mode } = resolveActiveMode(
      flagsFor(angleIndex, rtlIndex),
      inavBoxIds,
      "inav",
    );
    expect(mode).toBe("RTL");
  });

  it("yields UNKNOWN, not ACRO, when no mapped box is active", () => {
    const { mode } = resolveActiveMode(0, inavBoxIds, "inav");
    expect(mode).toBe("UNKNOWN");
    expect(givesStickAuthority(mode)).toBe(false);
  });

  it("yields UNKNOWN for an active box the table does not cover", () => {
    const unmapped = [200];
    const { mode } = resolveActiveMode(flagsFor(0), unmapped, "inav");
    expect(mode).toBe("UNKNOWN");
  });
});

describe("resolveActiveMode - Betaflight box table", () => {
  // Betaflight reports its own ids: ARM, ANGLE, HORIZON, GPS_RESCUE.
  const bfBoxIds = [0, 1, 2, 36];

  it.each([
    [1, "STABILIZE"],
    [2, "ALT_HOLD"],
    [36, "RTL"],
  ])("decodes Betaflight box %i as %s", (boxId, expected) => {
    const index = bfBoxIds.indexOf(boxId);
    const { mode } = resolveActiveMode(flagsFor(index), bfBoxIds, "betaflight");
    expect(mode).toBe(expected);
  });

  it("keeps ACRO as the Betaflight no-box-active default", () => {
    const { mode } = resolveActiveMode(0, bfBoxIds, "betaflight");
    expect(mode).toBe("ACRO");
  });

  it("does not decode Betaflight box 45 as RTL", () => {
    // 45 is iNav's NAV RTH; on Betaflight it is not a flight-mode box.
    const { mode } = resolveActiveMode(flagsFor(0), [45], "betaflight");
    expect(mode).not.toBe("RTL");
  });
});

describe("resolveActiveMode - unidentified firmware", () => {
  it("falls closed to UNKNOWN when the firmware is not yet known", () => {
    const { mode } = resolveActiveMode(0, [0, 1, 2], undefined);
    expect(mode).toBe("UNKNOWN");
    expect(givesStickAuthority(mode)).toBe(false);
  });
});
