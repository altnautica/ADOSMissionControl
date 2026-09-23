/**
 * @module protocol/critical-params
 * @description The one rule for which parameters are flight-safety critical.
 * The write-confirm dialog asks for an explicit acknowledgement before
 * changing them, and the disconnect guard and flash banner escalate when one
 * is written to RAM but not yet committed.
 * @license GPL-3.0-only
 */

/** Name prefixes of safety-critical parameters (ArduPilot and PX4). */
const CRITICAL_PREFIXES = [
  // ArduPilot: failsafes, fence, arming, battery, motor output, board safety,
  // rate-loop gains.
  "FS_", "BATT_", "FENCE_", "ARMING_", "MOT_", "BRD_", "ATC_RAT_",
  // ArduPlane throttle failsafe.
  "THR_FAILSAFE", "THR_FS_",
  // PX4: commander (arming, failsafe actions), geofence, navigator failsafes,
  // rate-loop gains.
  "COM_", "GF_", "NAV_", "MC_ROLLRATE_", "MC_PITCHRATE_", "MC_YAWRATE_",
];

/** RCn_OPTION assigns switch functions, including motor emergency stop and arm/disarm. */
const RC_OPTION = /^RC\d+_OPTION$/;

export function isCriticalParam(name: string): boolean {
  return RC_OPTION.test(name) || CRITICAL_PREFIXES.some((prefix) => name.startsWith(prefix));
}
