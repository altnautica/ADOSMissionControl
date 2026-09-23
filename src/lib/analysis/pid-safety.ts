/**
 * PID parameter safety validation.
 *
 * Defines safe ranges for copter and plane PID parameters, filter
 * parameters, and maximum allowed deltas per suggestion. A parameter with
 * no explicit range here is never written from a tuning suggestion.
 *
 * @license GPL-3.0-only
 */

import type { ParamSafetyRange, TuningVehicleType } from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Safety range definitions
// ---------------------------------------------------------------------------

/** Copter PID safe ranges. */
const COPTER_RANGES: Record<string, ParamSafetyRange> = {
  // Roll rate PID
  ATC_RAT_RLL_P: { min: 0.01, max: 0.5, maxDelta: 0.05 },
  ATC_RAT_RLL_I: { min: 0.01, max: 1.0, maxDelta: 0.05 },
  ATC_RAT_RLL_D: { min: 0.0, max: 0.05, maxDelta: 0.005 },
  ATC_RAT_RLL_FF: { min: 0.0, max: 1.0, maxDelta: 0.05 },
  ATC_RAT_RLL_FLTT: { min: 0, max: 100, maxDelta: 10 },
  ATC_RAT_RLL_FLTD: { min: 0, max: 100, maxDelta: 10 },
  // Pitch rate PID
  ATC_RAT_PIT_P: { min: 0.01, max: 0.5, maxDelta: 0.05 },
  ATC_RAT_PIT_I: { min: 0.01, max: 1.0, maxDelta: 0.05 },
  ATC_RAT_PIT_D: { min: 0.0, max: 0.05, maxDelta: 0.005 },
  ATC_RAT_PIT_FF: { min: 0.0, max: 1.0, maxDelta: 0.05 },
  ATC_RAT_PIT_FLTT: { min: 0, max: 100, maxDelta: 10 },
  ATC_RAT_PIT_FLTD: { min: 0, max: 100, maxDelta: 10 },
  // Yaw rate PID
  ATC_RAT_YAW_P: { min: 0.01, max: 0.5, maxDelta: 0.05 },
  ATC_RAT_YAW_I: { min: 0.01, max: 1.0, maxDelta: 0.05 },
  ATC_RAT_YAW_D: { min: 0.0, max: 0.05, maxDelta: 0.005 },
  ATC_RAT_YAW_FF: { min: 0.0, max: 1.0, maxDelta: 0.05 },
  ATC_RAT_YAW_FLTT: { min: 0, max: 100, maxDelta: 10 },
  ATC_RAT_YAW_FLTD: { min: 0, max: 100, maxDelta: 10 },
};

/** Plane PID safe ranges, keyed on the rate-controller names the PID panel edits. */
const PLANE_RANGES: Record<string, ParamSafetyRange> = {
  // Roll rate controller
  RLL_RATE_P: { min: 0.01, max: 0.5, maxDelta: 0.05 },
  RLL_RATE_I: { min: 0.01, max: 1.0, maxDelta: 0.05 },
  RLL_RATE_D: { min: 0.0, max: 0.05, maxDelta: 0.005 },
  RLL_RATE_IMAX: { min: 0, max: 1, maxDelta: 0.1 },
  RLL_RATE_FF: { min: 0.0, max: 3.0, maxDelta: 0.1 },
  // Pitch rate controller
  PTCH_RATE_P: { min: 0.01, max: 0.5, maxDelta: 0.05 },
  PTCH_RATE_I: { min: 0.01, max: 1.0, maxDelta: 0.05 },
  PTCH_RATE_D: { min: 0.0, max: 0.05, maxDelta: 0.005 },
  PTCH_RATE_IMAX: { min: 0, max: 1, maxDelta: 0.1 },
  PTCH_RATE_FF: { min: 0.0, max: 3.0, maxDelta: 0.1 },
  // Yaw (sideslip / damping / coordination)
  YAW2SRV_SLIP: { min: 0, max: 4, maxDelta: 0.25 },
  YAW2SRV_INT: { min: 0, max: 2, maxDelta: 0.25 },
  YAW2SRV_DAMP: { min: 0, max: 2, maxDelta: 0.25 },
  YAW2SRV_RLL: { min: 0.8, max: 1.2, maxDelta: 0.05 },
};

/** Vehicle-specific ranges. Rover has none, so rover suggestions are never applied. */
const VEHICLE_RANGES: Record<TuningVehicleType, Record<string, ParamSafetyRange>> = {
  copter: COPTER_RANGES,
  plane: PLANE_RANGES,
  rover: {},
};

/** Filter parameter safe ranges (shared across vehicle types). */
const FILTER_RANGES: Record<string, ParamSafetyRange> = {
  INS_GYRO_FILTER: { min: 10, max: 256, maxDelta: 20 },
  INS_ACCEL_FILTER: { min: 10, max: 256, maxDelta: 20 },
  INS_HNTCH_FREQ: { min: 10, max: 400, maxDelta: 50 },
  INS_HNTCH_BW: { min: 5, max: 200, maxDelta: 25 },
  INS_HNTC2_FREQ: { min: 10, max: 400, maxDelta: 50 },
  INS_HNTC2_BW: { min: 5, max: 200, maxDelta: 25 },
};

/** Tolerance for floating-point comparisons of parameter values. */
const EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the safety range for a PID or filter parameter.
 *
 * @param param       Parameter name (e.g., "ATC_RAT_RLL_P")
 * @param vehicleType Vehicle the parameter belongs to
 * @returns Safety range, or null when the parameter has no explicit range
 */
export function getSafetyRange(
  param: string,
  vehicleType: TuningVehicleType,
): ParamSafetyRange | null {
  if (Object.hasOwn(FILTER_RANGES, param)) return FILTER_RANGES[param];
  const vehicleRanges = VEHICLE_RANGES[vehicleType];
  if (vehicleRanges && Object.hasOwn(vehicleRanges, param)) return vehicleRanges[param];
  return null;
}

/** Outcome of checking one suggested parameter change. */
export type SuggestionCheck =
  /** The suggestion is applied as given. */
  | { status: "ok"; value: number }
  /** The suggestion is applied at a limited value. */
  | { status: "clamped"; value: number; warning: string }
  /** The suggestion is not applied. */
  | { status: "rejected"; reason: string };

/**
 * Validate a parameter suggestion against safety constraints.
 *
 * `currentValue` must be the flight controller's live value; a suggestion
 * for a parameter that is not loaded is rejected, as is any parameter
 * without an explicit safety range.
 *
 * The suggestion is first clamped into the safe range, then the step from
 * the current value is limited to the range's maxDelta. A current value that
 * already sits outside the range therefore moves toward it by at most
 * maxDelta per suggestion rather than snapping to the boundary.
 */
export function validateSuggestion(
  param: string,
  currentValue: number | undefined,
  suggestedValue: number,
  vehicleType: TuningVehicleType,
): SuggestionCheck {
  const range = getSafetyRange(param, vehicleType);
  if (!range) {
    return { status: "rejected", reason: `${param}: no safe range defined for ${vehicleType}` };
  }
  if (currentValue === undefined || !Number.isFinite(currentValue)) {
    return { status: "rejected", reason: `${param}: no confirmed flight controller value` };
  }
  if (!Number.isFinite(suggestedValue)) {
    return { status: "rejected", reason: `${param}: suggested value is not a number` };
  }

  const warnings: string[] = [];

  let target = suggestedValue;
  if (target < range.min) {
    warnings.push(`${suggestedValue} below minimum ${range.min}`);
    target = range.min;
  } else if (target > range.max) {
    warnings.push(`${suggestedValue} above maximum ${range.max}`);
    target = range.max;
  }

  let value = target;
  const step = target - currentValue;
  if (Math.abs(step) > range.maxDelta + EPSILON) {
    // Round away binary noise from the addition; the FC stores float32 anyway.
    value = Math.round((currentValue + Math.sign(step) * range.maxDelta) * 1e6) / 1e6;
    warnings.push(`change of ${Math.abs(step).toFixed(4)} exceeds max step ${range.maxDelta}`);
  }

  if (warnings.length === 0) return { status: "ok", value };
  return { status: "clamped", value, warning: `${param}: ${warnings.join("; ")}, limited to ${value}` };
}
