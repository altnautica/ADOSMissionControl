/**
 * Common motor mixer encoder shared with iNav (MSP2_COMMON_SET_MOTOR_MIXER).
 *
 * @module protocol/msp/encoders/inav/motor-mixer
 */

import type { MotorMixerRule } from '../../msp-decoders-inav';
import { writeU8, writeU16 } from './_helpers';

/** Mixer weight range the FC stores; it clamps the wire value to 0..4 then subtracts 2. */
const WEIGHT_MIN = -2;
const WEIGHT_MAX = 2;

/**
 * Encode MSP2_COMMON_SET_MOTOR_MIXER (0x1006) payload for one slot, 9 bytes.
 *
 * Layout: U8 idx, then U16 throttle, roll, pitch, yaw, each (weight + 2.0) x 1000.
 * A rule with throttle 0 marks the slot unused.
 */
export function encodeMspCommonSetMotorMixer(idx: number, rule: MotorMixerRule): Uint8Array {
  const buf = new Uint8Array(9);
  const dv = new DataView(buf.buffer);
  writeU8(dv, 0, idx & 0xff);
  const weights = [rule.throttle, rule.roll, rule.pitch, rule.yaw];
  weights.forEach((w, i) => {
    const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w));
    writeU16(dv, 1 + i * 2, Math.round((clamped + 2) * 1000));
  });
  return buf;
}
