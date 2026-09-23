/**
 * Outcome logic for the MSP (Betaflight / iNav) calibration surfaces.
 *
 * iNav calibrates the accelerometer from six orientations: each
 * MSP_ACC_CALIBRATION captures whichever orientation the board is held in,
 * and MSP_CALIBRATION_DATA reports one bit per captured orientation (0x3F once
 * all six are in, or when the board is already calibrated). The reply to the
 * command only means the capture started, so progress is judged from the
 * flags read afterwards, never from the command reply.
 */

export const INAV_ACC_ALL_POSITIONS = 0x3f;

/** iNav samples one orientation for 500 ms; read the flags back after this. */
export const INAV_ACC_CAPTURE_MS = 2000;

/** Betaflight averages 400 accelerometer samples, then saves; this covers it with margin. */
export const BF_ACC_CALIBRATION_MS = 2000;

/** iNav's default compass calibration time (mag_calibration_time), seconds. */
export const INAV_MAG_CAL_DEFAULT_S = 30;

export type InavAccelCapture = "captured" | "complete" | "rejected" | "none";

export function countPositions(flags: number): number {
  let n = 0;
  for (let bit = 0; bit < 6; bit++) if (flags & (1 << bit)) n++;
  return n;
}

/** Judge one capture from the orientation flags read before and after it. */
export function inavAccelCaptureOutcome(before: number, after: number): InavAccelCapture {
  if (before !== INAV_ACC_ALL_POSITIONS && after === INAV_ACC_ALL_POSITIONS) return "complete";
  // A sixth capture whose fit iNav rejects clears every sample.
  if (after === 0 && countPositions(before) === 5) return "rejected";
  // Top-up on a calibrated board restarts the six-point sequence.
  if (before === INAV_ACC_ALL_POSITIONS && after !== INAV_ACC_ALL_POSITIONS) return "captured";
  if ((after & ~before) !== 0) return "captured";
  return "none";
}

export function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
