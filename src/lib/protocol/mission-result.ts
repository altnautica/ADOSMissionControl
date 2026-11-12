/**
 * @module protocol/mission-result
 * @description How a mission upload ended, as a code the UI can put into
 * words: the vehicle's MAV_MISSION_RESULT, or one of the GCS-side outcomes
 * below (negative, so they never collide with a vehicle result).
 * @license GPL-3.0-only
 */

/** No answer, or the transfer was cancelled; the generic failure code. */
export const MISSION_TRANSFER_NO_ANSWER = -1;
/** The vehicle stopped asking for items before the transfer finished. */
export const MISSION_TRANSFER_STALLED = -2;
/** The link to the vehicle was not up when the upload started. */
export const MISSION_TRANSFER_NOT_CONNECTED = -3;
/** The upload was acknowledged but the mission read back differs from it. */
export const MISSION_TRANSFER_VERIFY_MISMATCH = -4;
/** The upload was acknowledged but reading it back for the check failed. */
export const MISSION_TRANSFER_VERIFY_FAILED = -5;

/**
 * The locale key (under `planner.send.result`) that names a mission upload
 * failure code. MAV_MISSION_RESULT values the vehicle may send map to their
 * own wording; anything else reads as an unknown refusal.
 */
export function missionResultKey(code: number): string {
  switch (code) {
    case MISSION_TRANSFER_NO_ANSWER: return "noAnswer";
    case MISSION_TRANSFER_STALLED: return "stalled";
    case MISSION_TRANSFER_NOT_CONNECTED: return "notConnected";
    case MISSION_TRANSFER_VERIFY_MISMATCH: return "verifyMismatch";
    case MISSION_TRANSFER_VERIFY_FAILED: return "verifyFailed";
    case 1: return "error";
    case 2: return "unsupportedFrame";
    case 3: return "unsupported";
    case 4: return "noSpace";
    case 5: return "invalid";
    case 6: case 7: case 8: case 9: case 12: return "invalidParam";
    case 10: case 11: return "invalidPosition";
    case 13: return "invalidSequence";
    case 14: return "denied";
    case 15: return "cancelled";
    default: return "unknown";
  }
}
