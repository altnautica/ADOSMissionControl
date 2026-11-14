/**
 * Parameters whose valid values are fixed here, whatever the vehicle's
 * metadata says or whether it is loaded. The firmware stores any value for
 * these and applies it, so the GCS is the only guard; every write path
 * (FC panels, Ctrl+S, the Parameters grid, file import) checks here.
 *
 * @module protocol/param-fixed-limits
 * @license GPL-3.0-only
 */

import { validateFlowOrientYaw } from "@/lib/sensors/flow-orient-yaw";

const FIXED: Record<string, (value: number) => boolean> = {
  // Centidegrees, -17999..18000 in steps of 10; a wrong value inverts the
  // optical flow feedback.
  FLOW_ORIENT_YAW: (value) => validateFlowOrientYaw(value).valid,
};

/** True when `value` must never be written to `name`. */
export function isParamValueRefused(name: string, value: number): boolean {
  const check = FIXED[name];
  return check !== undefined && !check(value);
}
