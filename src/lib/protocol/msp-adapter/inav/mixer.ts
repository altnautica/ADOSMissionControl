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
  if (!queue) return []
  try {
    const frame = await queue.send(INAV_MSP.MSP2_INAV_OUTPUT_MAPPING_EXT2)
    return decodeMspINavOutputMappingExt2(dv(frame.payload))
  } catch { return [] }
}

export async function inavGetTimerOutputModes(queue: MspSerialQueue | null): Promise<INavTimerOutputModeEntry[]> {
  if (!queue) return []
  try {
    const frame = await queue.send(INAV_MSP.MSP2_INAV_TIMER_OUTPUT_MODE)
    return decodeMspINavTimerOutputMode(dv(frame.payload))
  } catch { return [] }
}

export async function inavSetTimerOutputModes(queue: MspSerialQueue | null, entries: INavTimerOutputModeEntry[]): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_TIMER_OUTPUT_MODE, encodeMspINavSetTimerOutputMode(entries))
    return { success: true, resultCode: 0, message: 'Timer output modes saved' }
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

// ── Temperature sensors ───────────────────────────────────────


export async function inavDownloadMotorMixer(queue: MspSerialQueue | null): Promise<MotorMixerRule[]> {
  if (!queue) return []
  const frame = await queue.send(INAV_MSP.MSP2_COMMON_MOTOR_MIXER)
  return decodeMspCommonMotorMixer(dv(frame.payload))
}

/** A slot with throttle 0 is unused; the FC stops counting motors at the first one. */
const EMPTY_MOTOR_RULE: MotorMixerRule = { throttle: 0, roll: 0, pitch: 0, yaw: 0 }

/**
 * Write the motor mixer table. Slots past the last rule are written empty so a
 * motor removed in the editor cannot keep mixing from a stale slot on the FC.
 * The slot count is the length of the table the FC itself reports.
 */
export async function inavUploadMotorMixer(queue: MspSerialQueue | null, rules: MotorMixerRule[]): Promise<void> {
  if (!queue) return
  const current = await queue.send(INAV_MSP.MSP2_COMMON_MOTOR_MIXER)
  const slotCount = Math.floor(current.payload.byteLength / 8)
  if (rules.length > slotCount) {
    throw new Error(`This flight controller has ${slotCount} motor mixer slots; ${rules.length} rules do not fit`)
  }
  for (let i = 0; i < slotCount; i++) {
    await queue.send(INAV_MSP.MSP2_COMMON_SET_MOTOR_MIXER, encodeMspCommonSetMotorMixer(i, rules[i] ?? EMPTY_MOTOR_RULE))
  }
}

// ── Servo mixer download / upload ─────────────────────────────

export async function inavDownloadServoMixer(queue: MspSerialQueue | null): Promise<INavServoMixerRule[]> {
  if (!queue) return []
  const frame = await queue.send(INAV_MSP.MSP2_INAV_SERVO_MIXER)
  return decodeMspINavServoMixer(dv(frame.payload))
}

export async function inavUploadServoMixer(queue: MspSerialQueue | null, rules: INavServoMixerRule[]): Promise<void> {
  if (!queue) return
  for (let i = 0; i < rules.length; i++) {
    await queue.send(INAV_MSP.MSP2_INAV_SET_SERVO_MIXER, encodeMspINavSetServoMixer(i, rules[i]))
  }
}
