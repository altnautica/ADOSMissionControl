/**
 * iNav battery adapter functions: config read/write, battery and control
 * profile selection, and the active-profile readout.
 *
 * @module protocol/msp-adapter/inav/battery
 */

import type { CommandResult } from '../../types'
import type { MspSerialQueue } from '../../msp/msp-serial-queue'
import { formatErrorMessage } from '@/lib/utils'
import { MSP } from '../../msp/msp-constants'
import {
  INAV_MSP,
  decodeMspINavBatteryConfig,
  decodeMspINavStatus,
  type INavActiveProfiles,
  type INavBatteryConfig,
} from '../../msp/msp-decoders-inav'
import {
  encodeMspINavSetBatteryConfig,
  encodeMspINavSelectBatteryProfile,
} from '../../msp/msp-encoders-inav'
import { NOT_CONNECTED, dv } from './helpers'

/**
 * Read the active control and battery profiles. MSP2_INAV_STATUS byte 8
 * carries the battery profile in the high nibble and the control profile in
 * the low nibble.
 */
export async function inavGetActiveProfiles(queue: MspSerialQueue | null): Promise<INavActiveProfiles> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_STATUS)
  const { profiles } = decodeMspINavStatus(dv(frame.payload))
  return { controlProfile: profiles & 0x0f, batteryProfile: profiles >> 4 }
}

/**
 * Switch the control profile with MSP_SELECT_SETTING. The FC refuses the
 * switch while armed and saves the new selection itself.
 */
export async function inavSelectControlProfile(queue: MspSerialQueue | null, idx: number): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(MSP.MSP_SELECT_SETTING, new Uint8Array([idx & 0xff]))
    return { success: true, resultCode: 0, message: `Control profile ${idx + 1} selected` }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

export async function inavGetBatteryConfig(queue: MspSerialQueue | null): Promise<INavBatteryConfig> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_BATTERY_CONFIG)
  return decodeMspINavBatteryConfig(dv(frame.payload))
}

export async function inavSetBatteryConfig(queue: MspSerialQueue | null, cfg: INavBatteryConfig): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_BATTERY_CONFIG, encodeMspINavSetBatteryConfig(cfg))
    return { success: true, resultCode: 0, message: 'Battery config saved' }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

export async function inavSelectBatteryProfile(queue: MspSerialQueue | null, idx: number): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SELECT_BATTERY_PROFILE, encodeMspINavSelectBatteryProfile(idx))
    return { success: true, resultCode: 0, message: `Battery profile ${idx} selected` }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

// ── Mixer config ─────────────────────────────────────────────

