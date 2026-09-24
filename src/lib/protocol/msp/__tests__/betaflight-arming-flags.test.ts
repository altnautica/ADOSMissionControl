/**
 * @license GPL-3.0-only
 *
 * Betaflight arming-disable flags decode. Every set bit blocks arming (no
 * "OK to arm" bit), so the FC is ready exactly when the word is zero. The
 * Betaflight map is distinct from iNav's, so a BF word must not be read with
 * iNav semantics.
 */

import { describe, it, expect } from "vitest";

import { decodeBetaflightArmingFlags } from "../betaflight-arming-flags";
import { decodeArmingFlags } from "../inav-arming-flags";

describe("decodeBetaflightArmingFlags", () => {
  it("is OK to arm when no bits are set", () => {
    const r = decodeBetaflightArmingFlags(0);
    expect(r.okToArm).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("surfaces a single blocker and reports not-ok", () => {
    const r = decodeBetaflightArmingFlags(1 << 7); // THROTTLE
    expect(r.okToArm).toBe(false);
    expect(r.blockers).toEqual(["Throttle not low"]);
  });

  it("surfaces multiple blockers", () => {
    const r = decodeBetaflightArmingFlags((1 << 0) | (1 << 25)); // NO_GYRO + ARM_SWITCH
    expect(r.okToArm).toBe(false);
    expect(r.blockers).toContain("No gyro");
    expect(r.blockers).toContain("Arm switch");
    expect(r.blockers).toHaveLength(2);
  });

  it("labels an undocumented bit without dropping it", () => {
    const r = decodeBetaflightArmingFlags(1 << 30);
    expect(r.okToArm).toBe(false);
    expect(r.blockers).toEqual(["Unknown flag (bit 30)"]);
  });

  it("never emits informational notes (Betaflight has none)", () => {
    const r = decodeBetaflightArmingFlags((1 << 8) | (1 << 12));
    expect(r.notes).toEqual([]);
  });

  it("follows the flag count: ARM_SWITCH is the last flag on newer firmware", () => {
    // A 30-flag word: CRASHFLIP 25, ALTHOLD 26, POSHOLD 27, AUTOPILOT 28, ARM_SWITCH 29.
    const r = decodeBetaflightArmingFlags((1 << 25) | (1 << 29), 30);
    expect(r.blockers).toEqual(["Crash flip mode", "Arm switch"]);
  });
});

describe("decodeArmingFlags (iNav)", () => {
  it.each([
    [6, "Inside a no-arm geozone"],
    [28, "Pre-arm switch not set"],
    [29, "DShot beeper active"],
    [30, "Landing detected"],
  ])("bit %i blocks arming", (bit, label) => {
    const r = decodeArmingFlags(1 << bit);
    expect(r.okToArm).toBe(false);
    expect(r.blockers).toEqual([label]);
  });

  it("treats a set bit it does not know as a blocker, not as ready", () => {
    const r = decodeArmingFlags(1 << 31);
    expect(r.okToArm).toBe(false);
    expect(r.blockers).toEqual(["Unknown flag (bit 31)"]);
  });

  it("is ready with only status bits set", () => {
    const r = decodeArmingFlags((1 << 3) | (1 << 5)); // WAS_EVER_ARMED + SITL
    expect(r.okToArm).toBe(true);
    expect(r.notes).toHaveLength(2);
  });
});
