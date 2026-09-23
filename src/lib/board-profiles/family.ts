/**
 * Chip-family detection for ArduPilot board IDs.
 *
 * Used by the SLCAN flash arbiter to decide whether entering SLCAN mode
 * requires a reboot (F4: yes) or whether the firmware supports a
 * hot-switch via MAV_CMD_CAN_FORWARD on the same MAVLink link (F7/H7/G4).
 *
 * The mapping is sourced from the project's local board registry where a
 * row exists; for boards not in the registry we fall back to a small
 * hand-rolled table of common board IDs and finally to a conservative
 * "F4" default so unknown boards take the reboot path.
 *
 * @module lib/board-profiles/family
 * @license GPL-3.0-only
 */

import { findArduPilotBoard } from "../boards/ardupilot-boards";

/** Known chip families that affect SLCAN entry strategy. */
export type ChipFamily = "F4" | "F7" | "H7" | "G4" | "unknown";

/**
 * Board IDs (APJ_BOARD_ID) of F7/H7 builds that the registry has no row for,
 * paired with the MCU family of that build. Anything absent resolves to F4.
 */
const FAMILY_BY_BOARD_ID: ReadonlyMap<number, ChipFamily> = new Map([
  // ── F7 ──
  [51, "F7"], // Pixhawk 5X (FMUv5X, STM32F767)
  [145, "F7"], // Kakute F7 Mini

  // ── H7 ──
  [57, "H7"], // ARK FMUv6X
  [1022, "H7"], // mRo Control Zero Classic
  [1033, "H7"], // CubeOrange Joey
  [1075, "H7"], // Skystars H7 HD
  [1149, "H7"], // Matek H7A3
  [1411, "H7"], // JHEMCU H743HD
]);

/**
 * Map an MCU string from the board registry onto a chip family.
 * The registry uses values like "STM32F405", "STM32F767", "STM32H757".
 */
function familyFromMcu(mcu: string): ChipFamily {
  if (/STM32H7/i.test(mcu)) return "H7";
  if (/STM32F7/i.test(mcu)) return "F7";
  if (/STM32G4/i.test(mcu)) return "G4";
  if (/STM32F4|STM32F303/i.test(mcu)) return "F4";
  return "unknown";
}

/**
 * Resolve the chip family for an AP_FW_BOARD_ID.
 *
 * Strategy:
 *   1. If the board registry has a row, derive the family from its MCU
 *      field. The registry is the source of truth.
 *   2. Otherwise consult the hand-rolled common-board table above.
 *   3. Otherwise return "F4" as a conservative default — assume reboot is
 *      required so we never accidentally try a hot-switch on hardware that
 *      cannot handle it.
 */
export function detectChipFamily(boardId: number): ChipFamily {
  const entry = findArduPilotBoard(boardId);
  if (entry) {
    const fromRegistry = familyFromMcu(entry.mcu);
    if (fromRegistry !== "unknown") return fromRegistry;
  }
  const fallback = FAMILY_BY_BOARD_ID.get(boardId);
  if (fallback) return fallback;
  return "F4";
}

/**
 * True when entering SLCAN mode on this chip family requires a full FC
 * reboot to take effect. F4 builds re-route the CAN driver only on boot;
 * F7/H7/G4 builds can switch into CAN passthrough via MAV_CMD_CAN_FORWARD
 * on a live MAVLink link without a reboot.
 */
export function chipFamilyRequiresReboot(family: ChipFamily): boolean {
  return family === "F4" || family === "unknown";
}
