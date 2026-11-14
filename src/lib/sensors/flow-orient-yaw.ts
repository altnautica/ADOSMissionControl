/**
 * @module sensors/flow-orient-yaw
 * @description FLOW_ORIENT_YAW validation. The parameter is centidegrees,
 * -17999..+18000 in steps of 10; a sensor whose X axis points right of the
 * vehicle nose has a positive yaw. A wrong value inverts the flow feedback,
 * which "can lead to a flyaway"
 * (https://ardupilot.org/copter/docs/common-mtf-01.html). Values 1..7 are the
 * old 45° step meaning, which ArduPilot reads as 0.01..0.07°.
 * @license GPL-3.0-only
 */

export const FLOW_ORIENT_YAW_MIN = -17999;
export const FLOW_ORIENT_YAW_MAX = 18000;
export const FLOW_ORIENT_YAW_STEP = 10;
/** Straight, reversed (the INAV/FMT mounting of the MTF-01), and sideways. */
export const FLOW_ORIENT_YAW_PRESETS = [0, 18000, 9000, -9000] as const;

export type FlowYawIssue = "not_number" | "out_of_range" | "not_step" | "legacy";

export interface FlowYawValidation {
  /** The value may be written to the vehicle. */
  valid: boolean;
  issue: FlowYawIssue | null;
  /** The angle ArduPilot applies, in degrees. */
  degrees: number;
}

export function validateFlowOrientYaw(cdeg: number): FlowYawValidation {
  if (!Number.isFinite(cdeg)) return { valid: false, issue: "not_number", degrees: Number.NaN };
  const degrees = cdeg / 100;
  if (cdeg < FLOW_ORIENT_YAW_MIN || cdeg > FLOW_ORIENT_YAW_MAX) return { valid: false, issue: "out_of_range", degrees };
  if (Number.isInteger(cdeg) && cdeg >= 1 && cdeg <= 7) return { valid: false, issue: "legacy", degrees };
  if (cdeg % FLOW_ORIENT_YAW_STEP !== 0) return { valid: false, issue: "not_step", degrees };
  return { valid: true, issue: null, degrees };
}

/**
 * The centidegree value an old 45° step setting (1..7) meant: `step` × 45°,
 * wrapped into ArduPilot's (-18000, 18000]. 2 → 9000, 4 → 18000, 6 → -9000.
 */
export function legacyYawCdeg(step: number): number {
  const r = (step * 4500) % 36000;
  return r > 18000 ? r - 36000 : r;
}
