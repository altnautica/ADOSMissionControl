/**
 * Unit tests for decodeArmingFlags.
 *
 * iNav's `armingFlag_e` (`src/main/fc/runtime_config.h`) starts at
 * `ARMED = (1 << 2)`: bits 0 and 1 are undefined and the firmware NEVER sets
 * them. The table used to declare `0: OK_TO_ARM` / `1: PREVENT_ARMING` and
 * `okToArm` required bit 0, so it was permanently false and `PreArmPanel`
 * rendered a red BLOCKED badge with "0 blockers preventing arming" on an
 * airworthy aircraft. These tests assert against the real word, so the old
 * shape can't come back.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  INAV_ARMING_FLAGS,
  decodeArmingFlags,
} from "@/lib/protocol/msp/inav-arming-flags";

describe("decodeArmingFlags", () => {
  it("declares no entry for the two bits iNav never sets", () => {
    expect(INAV_ARMING_FLAGS[0]).toBeUndefined();
    expect(INAV_ARMING_FLAGS[1]).toBeUndefined();
  });

  it("reports ok-to-arm for the empty word, which is what a ready iNav sends", () => {
    // The word carries only the REASONS arming is disabled; no reasons means
    // the aircraft is ready. There is no positive "ok to arm" bit to wait for.
    const result = decodeArmingFlags(0);
    expect(result.okToArm).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.notes).toHaveLength(0);
  });

  it("reports ok-to-arm for an armed aircraft with no blockers", () => {
    const result = decodeArmingFlags(1 << 2); // ARMED
    expect(result.okToArm).toBe(true);
    expect(result.notes).toContain("Armed");
    expect(result.blockers).toHaveLength(0);
  });

  it("refuses ok-to-arm when any blocker bit is set", () => {
    const result = decodeArmingFlags(1 << 8); // NOT_LEVEL
    expect(result.okToArm).toBe(false);
    expect(result.blockers).toContain("Not level");
  });

  it("decodes multiple blockers correctly", () => {
    // bit 8 (NOT_LEVEL) + bit 9 (SENSORS_CALIBRATING) + bit 18 (RC_LINK)
    const mask = (1 << 8) | (1 << 9) | (1 << 18);
    const result = decodeArmingFlags(mask);
    expect(result.blockers).toContain("Not level");
    expect(result.blockers).toContain("Sensors calibrating");
    expect(result.blockers).toContain("RC link");
    expect(result.blockers).toHaveLength(3);
  });

  it("puts ARMED and WAS_EVER_ARMED into notes, not blockers", () => {
    const result = decodeArmingFlags((1 << 2) | (1 << 3));
    expect(result.notes).toContain("Armed");
    expect(result.notes).toContain("Was ever armed");
    expect(result.blockers).toHaveLength(0);
  });

  it("decodes both simulator bits into notes", () => {
    expect(decodeArmingFlags(1 << 4).notes).toContain("Simulator mode (HITL)");
    expect(decodeArmingFlags(1 << 5).notes).toContain("Simulator mode (SITL)");
  });

  it("surfaces an unknown bit as a blocker instead of hiding it", () => {
    // bit 31 has no entry in INAV_ARMING_FLAGS; a set bit the GCS cannot name
    // must not read as clear to arm.
    const result = decodeArmingFlags((1 << 31) >>> 0);
    expect(result.blockers).toEqual(["Unknown flag (bit 31)"]);
    expect(result.okToArm).toBe(false);
  });
});
