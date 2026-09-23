/**
 * @module lib/telemetry/failsafe-text
 * @description Whether a STATUSTEXT announces a failsafe starting. ArduPilot
 * and PX4 both announce failsafes this way ("Radio Failsafe - Disarming",
 * "Battery Failsafe", "EKF Failsafe", "Failsafe activated") and also announce
 * the end of one ("Radio Failsafe Cleared", "Failsafe deactivated"), which must
 * not raise the alert again.
 * @license GPL-3.0-only
 */

/** MAV_SEVERITY_WARNING: failsafe announcements are CRITICAL through WARNING. */
const MAX_SEVERITY = 4;

const FAILSAFE = /fail\s*-?\s*safe/i;
const ENDED = /\b(clear(ed)?|resolved|recovered|off|ended|exit(ed)?|deactivated)\b/i;

export function isFailsafeAnnouncement(severity: number, text: string): boolean {
  return severity <= MAX_SEVERITY && FAILSAFE.test(text) && !ENDED.test(text);
}
