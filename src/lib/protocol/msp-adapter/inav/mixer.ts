/**
 * iNav mixer adapter functions: platform mixer, mixer profile, output mapping,
 * timer output modes, servo config, motor mixer, servo mixer.
 *
 * @module protocol/msp-adapter/inav/mixer
 */

import type { CommandResult } from '../../types'
import type { MspSerialQueue } from '../../msp/msp-serial-queue'
import { formatErrorMessage } from '@/lib/utils'
import {
  INAV_MSP,
  decodeMspINavMixer,
  decodeMspINavOutputMappingExt2,
  decodeMspINavTimerOutputMode,
  decodeMspINavServoConfig,
  decodeMspCommonMotorMixer,
  decodeMspINavServoMixer,
  type INavMixer,
  type INavOutputMappingExt2Entry,
  type INavTimerOutputModeEntry,
  type INavServoConfig,
  type MotorMixerRule,
  type INavServoMixerRule,
} from '../../msp/msp-decoders-inav'
import {
  encodeMspINavSelectMixerProfile,
  encodeMspINavSetTimerOutputMode,
  encodeMspINavSetServoConfig,
  encodeMspCommonSetMotorMixer,
  encodeMspINavSetServoMixer,
} from '../../msp/msp-encoders-inav'
import { NOT_CONNECTED, dv } from './helpers'

export async function inavGetMixerConfig(queue: MspSerialQueue | null): Promise<INavMixer> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_MIXER)
  return decodeMspINavMixer(dv(frame.payload))
}

export async function inavSelectMixerProfile(queue: MspSerialQueue | null, idx: number): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SELECT_MIXER_PROFILE, encodeMspINavSelectMixerProfile(idx))
    return { success: true, resultCode: 0, message: `Mixer profile ${idx} selected` }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

// ── Output mapping ───────────────────────────────────────────

export async function inavGetOutputMapping(queue: MspSerialQueue | null): Promise<INavOutputMappingExt2Entry[]> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_OUTPUT_MAPPING_EXT2)
  return decodeMspINavOutputMappingExt2(dv(frame.payload))
}

export async function inavGetTimerOutputModes(queue: MspSerialQueue | null): Promise<INavTimerOutputModeEntry[]> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_TIMER_OUTPUT_MODE)
  return decodeMspINavTimerOutputMode(dv(frame.payload))
}

/** Set one timer's output mode (outputMode_e); the FC takes one timer per frame. */
export async function inavSetTimerOutputMode(queue: MspSerialQueue | null, entry: INavTimerOutputModeEntry): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_TIMER_OUTPUT_MODE, encodeMspINavSetTimerOutputMode(entry))
    return { success: true, resultCode: 0, message: `Timer ${entry.timerId} output mode saved` }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

// ── Servo config ─────────────────────────────────────────────

export async function inavGetServoConfigs(queue: MspSerialQueue | null): Promise<INavServoConfig[]> {
  if (!queue) return []
  try {
    const frame = await queue.send(INAV_MSP.MSP2_INAV_SERVO_CONFIG)
    return decodeMspINavServoConfig(dv(frame.payload))
  } catch { return [] }
}

export async function inavSetServoConfig(queue: MspSerialQueue | null, idx: number, cfg: INavServoConfig): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_SERVO_CONFIG, encodeMspINavSetServoConfig(idx, cfg))
    return { success: true, resultCode: 0, message: `Servo ${idx} config saved` }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

// ── Motor and servo mixer tables ──────────────────────────────
//
// With more than one mixer profile, the table replies carry this profile's
// slots and then the next profile's. The slot counts are the FC's own
// MAX_SUPPORTED_MOTORS and MAX_SERVO_RULES (2 x MAX_SUPPORTED_SERVOS), which
// MSP2_INAV_MIXER reports, so only this profile's block is read and written.

async function mixerSlots(queue: MspSerialQueue): Promise<{ motors: number; servoRules: number }> {
  const cfg = decodeMspINavMixer(dv((await queue.send(INAV_MSP.MSP2_INAV_MIXER)).payload))
  if (cfg.maxSupportedMotors === 0 || cfg.maxSupportedServos === 0) {
    throw new Error('The flight controller did not report its mixer table sizes')
  }
  return { motors: cfg.maxSupportedMotors, servoRules: 2 * cfg.maxSupportedServos }
}

/** This profile's motor rules, up to the first unused (throttle 0) slot. */
export async function inavDownloadMotorMixer(queue: MspSerialQueue | null): Promise<MotorMixerRule[]> {
  if (!queue) throw new Error('Not connected')
  const { motors } = await mixerSlots(queue)
  const frame = await queue.send(INAV_MSP.MSP2_COMMON_MOTOR_MIXER)
  return decodeMspCommonMotorMixer(dv(frame.payload.subarray(0, motors * 8)))
}

/** A slot with throttle 0 is unused; the FC stops counting motors at the first one. */
const EMPTY_MOTOR_RULE: MotorMixerRule = { throttle: 0, roll: 0, pitch: 0, yaw: 0 }

/**
 * Write the motor mixer table. Slots past the last rule are written empty so a
 * motor removed in the editor cannot keep mixing from a stale slot on the FC.
 */
export async function inavUploadMotorMixer(queue: MspSerialQueue | null, rules: MotorMixerRule[]): Promise<void> {
  if (!queue) throw new Error('Not connected')
  const { motors } = await mixerSlots(queue)
  if (rules.length > motors) {
    throw new Error(`This flight controller has ${motors} motor mixer slots; ${rules.length} rules do not fit`)
  }
  for (let i = 0; i < motors; i++) {
    await queue.send(INAV_MSP.MSP2_COMMON_SET_MOTOR_MIXER, encodeMspCommonSetMotorMixer(i, rules[i] ?? EMPTY_MOTOR_RULE))
  }
}

/** A servo rule with rate 0 is unused; the FC stops loading rules at the first one. */
const EMPTY_SERVO_RULE: INavServoMixerRule = { targetChannel: 0, inputSource: 0, rate: 0, speed: 0, conditionId: -1 }

/** This profile's servo rules, up to the first unused (rate 0) slot. */
export async function inavDownloadServoMixer(queue: MspSerialQueue | null): Promise<INavServoMixerRule[]> {
  if (!queue) throw new Error('Not connected')
  const { servoRules } = await mixerSlots(queue)
  const frame = await queue.send(INAV_MSP.MSP2_INAV_SERVO_MIXER)
  const rules = decodeMspINavServoMixer(dv(frame.payload.subarray(0, servoRules * 6)))
  const end = rules.findIndex((r) => r.rate === 0)
  return end === -1 ? rules : rules.slice(0, end)
}

/**
 * Write the servo mixer table, emptying every slot past the last rule so a
 * deleted rule cannot keep driving a servo from its old slot.
 */
export async function inavUploadServoMixer(queue: MspSerialQueue | null, rules: INavServoMixerRule[]): Promise<void> {
  if (!queue) throw new Error('Not connected')
  const { servoRules } = await mixerSlots(queue)
  if (rules.length > servoRules) {
    throw new Error(`This flight controller has ${servoRules} servo mixer slots; ${rules.length} rules do not fit`)
  }
  for (let i = 0; i < servoRules; i++) {
    await queue.send(INAV_MSP.MSP2_INAV_SET_SERVO_MIXER, encodeMspINavSetServoMixer(i, rules[i] ?? EMPTY_SERVO_RULE))
  }
}
