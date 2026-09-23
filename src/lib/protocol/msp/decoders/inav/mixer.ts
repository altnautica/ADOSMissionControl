/**
 * iNav mixer decoders: platform mixer, servo mixer rules, servo config,
 * output mapping, timer output mode, and the common motor mixer table.
 *
 * @module protocol/msp/decoders/inav/mixer
 */

import { readU8, readU16, readS16 } from "./helpers";
import type {
  INavMixer,
  INavTimerOutputModeEntry,
  INavOutputMappingExt2Entry,
  INavServoMixerRule,
  INavServoConfig,
  MotorMixerRule,
} from "./types";

// ── iNav MIXER decoder ───────────────────────────────────────

/**
 * MSP2_INAV_MIXER (0x2010), 9 bytes:
 *
 * U8  motorDirectionInverted (bool)
 * U8  0 (formerly yaw_jump_prevention_limit)
 * U8  motorstopOnLow (bool)
 * U8  platformType (0=MULTIROTOR, 1=AIRPLANE, 2=TRICOPTER, 3=ROVER, 4=BOAT, 5=HELICOPTER)
 * U8  hasFlaps (bool)
 * U16 appliedMixerPreset
 * U8  MAX_SUPPORTED_MOTORS
 * U8  MAX_SUPPORTED_SERVOS
 */
export function decodeMspINavMixer(dv: DataView): INavMixer {
  return {
    motorDirectionInverted: readU8(dv, 0) !== 0,
    motorstopOnLow: readU8(dv, 2) !== 0,
    platformType: readU8(dv, 3),
    hasFlaps: readU8(dv, 4) !== 0,
    appliedMixerPreset: readU16(dv, 5),
    maxSupportedMotors: readU8(dv, 7),
    maxSupportedServos: readU8(dv, 8),
  };
}

// ── iNav TIMER OUTPUT MODE decoder ───────────────────────────

/**
 * MSP2_INAV_TIMER_OUTPUT_MODE (0x200e)
 *
 * Repeated for each timer:
 *   U8 timerId
 *   U8 mode
 */
export function decodeMspINavTimerOutputMode(dv: DataView): INavTimerOutputModeEntry[] {
  const result: INavTimerOutputModeEntry[] = [];
  let offset = 0;
  while (offset + 1 < dv.byteLength) {
    result.push({
      timerId: readU8(dv, offset),
      mode: readU8(dv, offset + 1),
    });
    offset += 2;
  }
  return result;
}

// ── iNav OUTPUT MAPPING EXT2 decoder ─────────────────────────

/**
 * MSP2_INAV_OUTPUT_MAPPING_EXT2 (0x210d)
 *
 * Repeated for each output:
 *   U8 timerId
 *   U16 usageFlags
 *   U16 specialLabels
 */
export function decodeMspINavOutputMappingExt2(dv: DataView): INavOutputMappingExt2Entry[] {
  const result: INavOutputMappingExt2Entry[] = [];
  let offset = 0;
  while (offset + 4 < dv.byteLength) {
    result.push({
      timerId: readU8(dv, offset),
      usageFlags: readU16(dv, offset + 1),
      specialLabels: readU16(dv, offset + 3),
    });
    offset += 5;
  }
  return result;
}

// ── iNav SERVO MIXER decoder ──────────────────────────────────

/**
 * MSP2_INAV_SERVO_MIXER (0x2020)
 *
 * Repeated per rule:
 *   U8  targetChannel
 *   U8  inputSource
 *   S16 rate
 *   U8  speed
 *   U8  conditionId (or -1 if none)
 */
export function decodeMspINavServoMixer(dv: DataView): INavServoMixerRule[] {
  const result: INavServoMixerRule[] = [];
  let offset = 0;
  while (offset + 5 < dv.byteLength) {
    result.push({
      targetChannel: readU8(dv, offset),
      inputSource: readU8(dv, offset + 1),
      rate: readS16(dv, offset + 2),
      speed: readU8(dv, offset + 4),
      conditionId: dv.byteLength > offset + 5 ? readU8(dv, offset + 5) : 0,
    });
    offset += 6;
  }
  return result;
}

// ── iNav SERVO CONFIG decoder ─────────────────────────────────

/** Bytes per servo slot in MSP2_INAV_SERVO_CONFIG. */
const SERVO_CONFIG_RECORD = 7;

/**
 * MSP2_INAV_SERVO_CONFIG (0x2200)
 *
 * Repeated per servo slot (7 bytes each):
 *   S16 min (us)
 *   S16 max (us)
 *   S16 middle (us)
 *   S8  rate (%)
 */
export function decodeMspINavServoConfig(dv: DataView): INavServoConfig[] {
  const result: INavServoConfig[] = [];
  for (let offset = 0; offset + SERVO_CONFIG_RECORD <= dv.byteLength; offset += SERVO_CONFIG_RECORD) {
    result.push({
      min: readS16(dv, offset),
      max: readS16(dv, offset + 2),
      middle: readS16(dv, offset + 4),
      rate: dv.getInt8(offset + 6),
    });
  }
  return result;
}

/** Bytes per slot in MSP2_COMMON_MOTOR_MIXER. */
const MOTOR_MIXER_RECORD = 8;

/** The FC carries each mixer weight as u16 (weight + 2.0) x 1000. */
function mixerWeight(dv: DataView, offset: number): number {
  return (readU16(dv, offset) - 2000) / 1000;
}

/**
 * Decode MSP2_COMMON_MOTOR_MIXER (0x1005) response.
 *
 * A flat array of 8-byte records in slot order (no index field), one per
 * MAX_SUPPORTED_MOTORS slot. Each record: U16 throttle, U16 roll, U16 pitch,
 * U16 yaw, every one (weight + 2.0) x 1000. A slot whose throttle weight is 0
 * is unused on the FC, and the FC stops counting motors at the first one, so
 * decoding stops there too.
 */
export function decodeMspCommonMotorMixer(dv: DataView): MotorMixerRule[] {
  const rules: MotorMixerRule[] = [];
  for (let offset = 0; offset + MOTOR_MIXER_RECORD <= dv.byteLength; offset += MOTOR_MIXER_RECORD) {
    const throttle = mixerWeight(dv, offset);
    if (throttle === 0) break;
    rules.push({
      throttle,
      roll: mixerWeight(dv, offset + 2),
      pitch: mixerWeight(dv, offset + 4),
      yaw: mixerWeight(dv, offset + 6),
    });
  }
  return rules;
}
