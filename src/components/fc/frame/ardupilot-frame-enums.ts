/**
 * @module fc/frame/ardupilot-frame-enums
 * @description Frame parameters of the ArduPilot vehicles whose frame is not a
 * multirotor motor layout. ArduRover keeps FRAME_CLASS / FRAME_TYPE with its
 * own values; ArduSub has neither and selects its thruster layout with
 * FRAME_CONFIG.
 * @license GPL-3.0-only
 */

import type { EnumOption } from "./enum-options";

/** ArduRover FRAME_CLASS. */
export const ROVER_FRAME_CLASS_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — Undefined" },
  { value: "1", label: "1 — Rover" },
  { value: "2", label: "2 — Boat" },
  { value: "3", label: "3 — BalanceBot" },
];

/** ArduRover FRAME_TYPE (omni / mecanum motor arrangements). */
export const ROVER_FRAME_TYPE_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — Default" },
  { value: "1", label: "1 — Omni3" },
  { value: "2", label: "2 — OmniX" },
  { value: "3", label: "3 — OmniPlus" },
  { value: "4", label: "4 — Omni3Mecanum" },
];

/** ArduSub FRAME_CONFIG. */
export const SUB_FRAME_CONFIG_OPTIONS: readonly EnumOption[] = [
  { value: "0", label: "0 — BlueROV1" },
  { value: "1", label: "1 — Vectored" },
  { value: "2", label: "2 — Vectored 6DOF" },
  { value: "3", label: "3 — Vectored 6DOF 90" },
  { value: "4", label: "4 — SimpleROV-3" },
  { value: "5", label: "5 — SimpleROV-4" },
  { value: "6", label: "6 — SimpleROV-5" },
  { value: "7", label: "7 — Custom" },
];
