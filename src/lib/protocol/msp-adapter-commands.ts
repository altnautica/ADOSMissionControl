/**
 * MSP adapter — command methods.
 *
 * All supported and unsupported command methods for the MSP adapter.
 *
 * @module protocol/msp-adapter-commands
 */

import type { CommandResult, UnifiedFlightMode, MissionItem, LogEntry, LogDownloadProgressCallback } from './types'
import { formatErrorMessage } from '@/lib/utils'
import type { MspSerialQueue } from './msp/msp-serial-queue'
import { MSP } from './msp/msp-constants'
import { findModeRange, type ModeRange } from './msp/msp-mode-map'

const NOT_SUPPORTED: CommandResult = {
  success: false, resultCode: -1, message: 'Not supported by MSP firmware',
}

const NOT_CONNECTED: CommandResult = {
  success: false, resultCode: -1, message: 'Not connected',
}

function writeU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >> 8) & 0xff
}

export interface MspCommandContext {
  queue: MspSerialQueue | null
  modeRanges: ModeRange[]
}

export async function mspArm(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  const armRange = findModeRange(ctx.modeRanges, 0)
  if (!armRange) {
    try {
      const payload = new Uint8Array(1)
      payload[0] = 0
      await ctx.queue.send(MSP.MSP_ARMING_DISABLE, payload)
      return { success: true, resultCode: 0, message: 'Arming enabled via MSP' }
    } catch (err) {
      return { success: false, resultCode: -1, message: `Arm failed: ${formatErrorMessage(err)}` }
    }
  }
  return mspSetAuxChannel(ctx, armRange.auxChannel, Math.round((armRange.rangeStart + armRange.rangeEnd) / 2))
}

export async function mspDisarm(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  const armRange = findModeRange(ctx.modeRanges, 0)
  if (!armRange) {
    try {
      const payload = new Uint8Array(1)
      payload[0] = 1
      await ctx.queue.send(MSP.MSP_ARMING_DISABLE, payload)
      return { success: true, resultCode: 0, message: 'Disarmed via MSP' }
    } catch (err) {
      return { success: false, resultCode: -1, message: `Disarm failed: ${formatErrorMessage(err)}` }
    }
  }
  return mspSetAuxChannel(ctx, armRange.auxChannel, 1000)
}

export async function mspSetFlightMode(_ctx: MspCommandContext, _mode: UnifiedFlightMode): Promise<CommandResult> {
  return {
    success: false, resultCode: -1,
    message: 'Use AUX mode ranges to activate modes. Direct mode switching is not supported in MSP.',
  }
}

export function mspSendManualControl(ctx: MspCommandContext, roll: number, pitch: number, throttle: number, yaw: number): void {
  if (!ctx.queue) return
  const payload = new Uint8Array(16)
  writeU16(payload, 0, Math.round(roll / 2 + 1500))
  writeU16(payload, 2, Math.round(pitch / 2 + 1500))
  writeU16(payload, 4, Math.round(throttle / 2 + 1500))
  writeU16(payload, 6, Math.round(yaw / 2 + 1500))
  writeU16(payload, 8, 1500)
  writeU16(payload, 10, 1500)
  writeU16(payload, 12, 1500)
  writeU16(payload, 14, 1500)
  ctx.queue.sendNoReply(MSP.MSP_SET_RAW_RC, payload)
}

export async function mspMotorTest(ctx: MspCommandContext, motor: number, throttle: number): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  try {
    const payload = new Uint8Array(16)
    for (let i = 0; i < 8; i++) {
      const value = i === motor ? Math.round(1000 + (throttle / 100) * 1000) : 1000
      writeU16(payload, i * 2, value)
    }
    await ctx.queue.send(MSP.MSP_SET_MOTOR, payload)
    return { success: true, resultCode: 0, message: `Motor ${motor} set to ${throttle}%` }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Motor test failed: ${formatErrorMessage(err)}` }
  }
}

export async function mspReboot(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  try {
    const payload = new Uint8Array(1)
    payload[0] = 0
    await ctx.queue.send(MSP.MSP_SET_REBOOT, payload)
    return { success: true, resultCode: 0, message: 'Rebooting firmware' }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Reboot failed: ${formatErrorMessage(err)}` }
  }
}

export async function mspRebootToBootloader(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  try {
    const payload = new Uint8Array(1)
    payload[0] = 1
    await ctx.queue.send(MSP.MSP_SET_REBOOT, payload)
    return { success: true, resultCode: 0, message: 'Rebooting to bootloader' }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Bootloader reboot failed: ${formatErrorMessage(err)}` }
  }
}

export async function mspStartCalibration(
  ctx: MspCommandContext,
  type: 'accel' | 'gyro' | 'compass' | 'level' | 'airspeed' | 'baro' | 'rc' | 'esc' | 'compassmot',
): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  switch (type) {
    case 'accel':
    case 'level': {
      try {
        await ctx.queue.send(MSP.MSP_ACC_CALIBRATION)
        return { success: true, resultCode: 0, message: 'Accelerometer calibration started' }
      } catch (err) {
        return { success: false, resultCode: -1, message: `Accel cal failed: ${formatErrorMessage(err)}` }
      }
    }
    case 'compass': {
      try {
        await ctx.queue.send(MSP.MSP_MAG_CALIBRATION)
        return { success: true, resultCode: 0, message: 'Magnetometer calibration started' }
      } catch (err) {
        return { success: false, resultCode: -1, message: `Mag cal failed: ${formatErrorMessage(err)}` }
      }
    }
    default:
      return { success: false, resultCode: -1, message: `Calibration type '${type}' not supported by MSP` }
  }
}

export async function mspCommitParamsToFlash(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  try {
    await ctx.queue.send(MSP.MSP_EEPROM_WRITE)
    return { success: true, resultCode: 0, message: 'EEPROM saved' }
  } catch (err) {
    return { success: false, resultCode: -1, message: `EEPROM write failed: ${formatErrorMessage(err)}` }
  }
}

export async function mspKillSwitch(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  const payload = new Uint8Array(16)
  writeU16(payload, 0, 1500)
  writeU16(payload, 2, 1500)
  writeU16(payload, 4, 885)
  writeU16(payload, 6, 1500)
  for (let i = 4; i < 8; i++) writeU16(payload, i * 2, 1000)
  ctx.queue.sendNoReply(MSP.MSP_SET_RAW_RC, payload)
  return { success: true, resultCode: 0, message: 'Kill switch activated' }
}

export async function mspDoPreArmCheck(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  try {
    const frame = await ctx.queue.send(MSP.MSP_STATUS_EX)
    const payload = frame.payload
    if (payload.length < 15) return { success: false, resultCode: -1, message: 'Invalid status response' }
    const armingDisableFlags = payload.length >= 17
      ? (payload[13] | (payload[14] << 8) | (payload[15] << 16) | (payload[16] << 24)) >>> 0
      : payload[13] | (payload[14] << 8)
    if (armingDisableFlags === 0) return { success: true, resultCode: 0, message: 'Pre-arm checks passed' }
    return { success: false, resultCode: -1, message: `Arming disabled: flags=0x${armingDisableFlags.toString(16)}` }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Pre-arm check failed: ${formatErrorMessage(err)}` }
  }
}

// Unsupported commands
export async function mspReturnToLaunch(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspLand(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspTakeoff(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspGuidedGoto(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspPauseMission(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspResumeMission(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspClearMission(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspSetHome(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspChangeSpeed(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspSetYaw(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspSetGeoFenceEnabled(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspSetServo(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspCameraTrigger(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspSetGimbalAngle(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspUploadMission(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspDownloadMission(): Promise<MissionItem[]> { return [] }
export async function mspSetCurrentMissionItem(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspResetParametersToDefault(): Promise<CommandResult> { return NOT_SUPPORTED }
export async function mspGetLogList(): Promise<LogEntry[]> { return [] }
export async function mspDownloadLog(_logId: number, _onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> { return new Uint8Array(0) }
export async function mspEraseAllLogs(): Promise<CommandResult> { return NOT_SUPPORTED }

async function mspSetAuxChannel(ctx: MspCommandContext, auxIndex: number, pwmValue: number): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  const channelCount = 8
  const payload = new Uint8Array(channelCount * 2)
  writeU16(payload, 0, 1500)
  writeU16(payload, 2, 1500)
  writeU16(payload, 4, 1000)
  writeU16(payload, 6, 1500)
  for (let i = 4; i < channelCount; i++) writeU16(payload, i * 2, 1000)
  const channelIndex = auxIndex + 4
  if (channelIndex < channelCount) writeU16(payload, channelIndex * 2, pwmValue)
  ctx.queue.sendNoReply(MSP.MSP_SET_RAW_RC, payload)
  return { success: true, resultCode: 0, message: `AUX${auxIndex + 1} set to ${pwmValue}` }
}
