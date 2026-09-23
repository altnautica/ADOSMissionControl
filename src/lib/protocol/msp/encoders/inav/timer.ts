/**
 * iNav timer output mode encoder.
 *
 * @module protocol/msp/encoders/inav/timer
 */

import type { INavTimerOutputModeEntry } from '../../msp-decoders-inav';

/**
 * Encode MSP2_INAV_SET_TIMER_OUTPUT_MODE (0x200F) payload for one timer. The
 * FC accepts exactly two bytes: U8 timerId, U8 mode (outputMode_e).
 */
export function encodeMspINavSetTimerOutputMode(entry: INavTimerOutputModeEntry): Uint8Array {
  return new Uint8Array([entry.timerId & 0xff, entry.mode & 0xff]);
}
