/**
 * Betaflight arming-disable flags decoder.
 *
 * Betaflight reports a 32-bit `armingDisableFlags` word in MSP_STATUS_EX. It is
 * distinct from iNav's arming-flags word (different bit meanings), so it needs
 * its own map. Every set bit is a reason arming is blocked — there is no
 * "OK to arm" bit — so the FC is ready to arm exactly when the word is zero.
 *
 * @module protocol/msp/betaflight-arming-flags
 */

import type { ArmingFlagEntry, DecodeArmingFlagsResult } from "./inav-arming-flags";

/**
 * Bit-position to label map for Betaflight arming-disable flags, as laid out
 * by 4.4 and 4.5 (26 flags, ARM_SWITCH last at bit 25). Bit 0 is the
 * least-significant bit of the 32-bit word. Every entry is a blocker. Bits 3
 * and 20 were renamed across releases (BAD_RX_RECOVERY / NOT_DISARMED,
 * RPMFILTER / DSHOT_TELEM); the labels name what both mean.
 */
export const BETAFLIGHT_ARMING_DISABLE_FLAGS: Record<number, ArmingFlagEntry> = {
  0:  { name: "NO_GYRO",            label: "No gyro",                  isBlocker: true },
  1:  { name: "FAILSAFE",           label: "Failsafe",                 isBlocker: true },
  2:  { name: "RX_FAILSAFE",        label: "RX failsafe",              isBlocker: true },
  3:  { name: "NOT_DISARMED",       label: "Arm switch on after RX recovery", isBlocker: true },
  4:  { name: "BOXFAILSAFE",        label: "Box failsafe",             isBlocker: true },
  5:  { name: "RUNAWAY_TAKEOFF",    label: "Runaway takeoff",          isBlocker: true },
  6:  { name: "CRASH_DETECTED",     label: "Crash detected",           isBlocker: true },
  7:  { name: "THROTTLE",           label: "Throttle not low",         isBlocker: true },
  8:  { name: "ANGLE",              label: "Craft not level",          isBlocker: true },
  9:  { name: "BOOT_GRACE_TIME",    label: "Boot grace time",          isBlocker: true },
  10: { name: "NOPREARM",           label: "Pre-arm not set",          isBlocker: true },
  11: { name: "LOAD",               label: "System load too high",     isBlocker: true },
  12: { name: "CALIBRATING",        label: "Sensors calibrating",      isBlocker: true },
  13: { name: "CLI",                label: "CLI active",               isBlocker: true },
  14: { name: "CMS_MENU",           label: "CMS menu open",            isBlocker: true },
  15: { name: "BST",                label: "BST active",               isBlocker: true },
  16: { name: "MSP",                label: "MSP link active",          isBlocker: true },
  17: { name: "PARALYZE",           label: "Paralyze mode",            isBlocker: true },
  18: { name: "GPS",                label: "GPS rescue unavailable",   isBlocker: true },
  19: { name: "RESC",               label: "GPS rescue active",        isBlocker: true },
  20: { name: "DSHOT_TELEM",        label: "DShot telemetry required", isBlocker: true },
  21: { name: "REBOOT_REQUIRED",    label: "Reboot required",          isBlocker: true },
  22: { name: "DSHOT_BITBANG",      label: "DShot bitbang",            isBlocker: true },
  23: { name: "ACC_CALIBRATION",    label: "Accelerometer not calibrated", isBlocker: true },
  24: { name: "MOTOR_PROTOCOL",     label: "Motor protocol disabled",  isBlocker: true },
  25: { name: "ARM_SWITCH",         label: "Arm switch",               isBlocker: true },
};

/** Flags a newer Betaflight inserts at 25-28, moving ARM_SWITCH to the end. */
const BETAFLIGHT_LATER_FLAGS: Record<number, ArmingFlagEntry> = {
  25: { name: "CRASHFLIP",          label: "Crash flip mode",          isBlocker: true },
  26: { name: "ALTHOLD",            label: "Altitude hold switch on",  isBlocker: true },
  27: { name: "POSHOLD",            label: "Position hold switch on",  isBlocker: true },
  28: { name: "AUTOPILOT",          label: "Autopilot mode switch on", isBlocker: true },
};

/** Flag count of the 4.4/4.5 layout the base table describes. */
const BASE_FLAG_COUNT = 26;

/**
 * Decode a 32-bit Betaflight arming-disable bitmask into structured output.
 *
 * `flagCount` is ARMING_DISABLE_FLAGS_COUNT, sent in MSP_STATUS_EX just before
 * the word. ARM_SWITCH is always the last flag, so the count says which bit it
 * is and which layout the rest follow; without it the 4.4/4.5 layout is
 * assumed.
 *
 * Every set bit blocks arming, so `okToArm` is true exactly when no bits are
 * set. `blockers` carries a label per set bit; `notes` is always empty
 * (Betaflight has no informational arming bits, unlike iNav).
 */
export function decodeBetaflightArmingFlags(
  bitmask: number,
  flagCount: number = BASE_FLAG_COUNT,
): DecodeArmingFlagsResult {
  const blockers: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if ((bitmask & (1 << bit)) === 0) continue;
    const entry = bit === flagCount - 1
      ? BETAFLIGHT_ARMING_DISABLE_FLAGS[25]
      : flagCount > BASE_FLAG_COUNT && bit >= 25
        ? BETAFLIGHT_LATER_FLAGS[bit]
        : bit < 25 ? BETAFLIGHT_ARMING_DISABLE_FLAGS[bit] : undefined;
    blockers.push(entry ? entry.label : `Unknown flag (bit ${bit})`);
  }
  return { okToArm: bitmask === 0, blockers, notes: [] };
}
