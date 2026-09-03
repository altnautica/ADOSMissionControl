/**
 * MSP adapter — command methods.
 *
 * All supported and unsupported command methods for the MSP adapter.
 *
 * @module protocol/msp-adapter-commands
 */

import type { CommandResult, UnifiedFlightMode, MissionItem, LogEntry, LogDownloadProgressCallback, FirmwareType } from './types'
import { MODE_TO_INAV_BOX, INAV_BOX_LABELS } from './firmware/inav'
import { formatErrorMessage } from '@/lib/utils'
import type { MspSerialQueue } from './msp/msp-serial-queue'
import { MSP } from './msp/msp-constants'
import { findModeRange, type ModeRange } from './msp/msp-mode-map'
import type { MspRcOverride } from './msp/msp-rc-override'

const NOT_SUPPORTED: CommandResult = {
  success: false, resultCode: -1, message: 'Not supported by MSP firmware',
}

const NOT_CONNECTED: CommandResult = {
  success: false, resultCode: -1, message: 'Not connected',
}

const NO_RC_OVERRIDE: CommandResult = {
  success: false, resultCode: -1, message: 'RC override is not available on this link',
}

function writeU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >> 8) & 0xff
}

export interface MspCommandContext {
  queue: MspSerialQueue | null
  modeRanges: ModeRange[]
  /** Owns every `MSP_SET_RAW_RC` frame on this link. Null before connect. */
  rc: MspRcOverride | null
  /**
   * Which MSP firmware answered the handshake. Navigation modes exist only on
   * iNav, and their box ids differ from Betaflight's, so a command that drives
   * one has to know which firmware it is talking to.
   */
  firmwareType?: FirmwareType
  /**
   * Last armed flag decoded from MSP_STATUS_EX. MSP has no arm query, so this
   * is the only arm state the link has; safety gates read it from here.
   */
  isArmed?: () => boolean
}

export async function mspArm(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  // Arming is the operator asking to fly, so it is the one command that
  // releases a latched motor cut. Nothing else clears the latch.
  ctx.rc?.releaseCut()
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
  // Drive the arm channel to the value the model proved sits outside every
  // range configured on it, rather than assuming a literal 1000 is low enough.
  const idle = ctx.rc?.idleValueFor(armRange.auxChannel)
  if (idle == null) {
    return {
      success: false, resultCode: -1,
      message: `Disarm failed: no value on AUX${armRange.auxChannel + 1} leaves the arm range`,
    }
  }
  return mspSetAuxChannel(ctx, armRange.auxChannel, idle)
}

export async function mspSetFlightMode(_ctx: MspCommandContext, _mode: UnifiedFlightMode): Promise<CommandResult> {
  return {
    success: false, resultCode: -1,
    message: 'Use AUX mode ranges to activate modes. Direct mode switching is not supported in MSP.',
  }
}

/**
 * Emit one live stick frame. Roll, pitch, and yaw are -1..1; throttle is 0..1
 * with 0 as idle, matching what the MAVLink adapter scales. The channel model
 * decides whether the frame reaches the wire; a refused frame is not sent.
 */
export function mspSendManualControl(ctx: MspCommandContext, roll: number, pitch: number, throttle: number, yaw: number): void {
  ctx.rc?.sendSticks(roll, pitch, throttle, yaw)
}

/**
 * Per-link motor-test stop timers.
 *
 * MSP has no server-side motor-test timeout: `MSP_SET_MOTOR` is a level, not
 * a pulse, so the motor holds whatever was last written. The `duration`
 * argument used to be accepted and dropped, which left a motor spinning until
 * something else happened to write the outputs. The stop frame is therefore
 * scheduled here, keyed by the link's own queue so two adapters cannot
 * cancel each other's test.
 */
const motorTestStops = new WeakMap<MspSerialQueue, ReturnType<typeof setTimeout>>()

function clearMotorTestStop(queue: MspSerialQueue): void {
  const timer = motorTestStops.get(queue)
  if (timer !== undefined) { clearTimeout(timer); motorTestStops.delete(queue) }
}

function allMotorsIdle(): Uint8Array {
  const payload = new Uint8Array(16)
  for (let i = 0; i < 8; i++) writeU16(payload, i * 2, 1000)
  return payload
}

/**
 * Spin one motor at `throttle` percent for `durationSeconds`, then idle every
 * output. Refused while armed: a bench motor test on an armed airframe is the
 * one case where a wrong output is an injury.
 */
export async function mspMotorTest(
  ctx: MspCommandContext,
  motor: number,
  throttle: number,
  durationSeconds: number,
): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  if (ctx.isArmed?.()) {
    return { success: false, resultCode: -1, message: 'Motor test refused: vehicle is armed' }
  }
  const queue = ctx.queue
  try {
    clearMotorTestStop(queue)
    const payload = new Uint8Array(16)
    for (let i = 0; i < 8; i++) {
      const value = i === motor ? Math.round(1000 + (throttle / 100) * 1000) : 1000
      writeU16(payload, i * 2, value)
    }
    await queue.send(MSP.MSP_SET_MOTOR, payload)
    if (durationSeconds > 0) {
      motorTestStops.set(queue, setTimeout(() => {
        motorTestStops.delete(queue)
        void queue.send(MSP.MSP_SET_MOTOR, allMotorsIdle()).catch(() => {
          // The link went away, which stops the motor at the FC's own RC-loss
          // failsafe. Nothing further to do from here.
        })
      }, durationSeconds * 1000))
    }
    return { success: true, resultCode: 0, message: `Motor ${motor} set to ${throttle}% for ${durationSeconds}s` }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Motor test failed: ${formatErrorMessage(err)}` }
  }
}

/**
 * Cancel a scheduled motor-test stop. Called on disconnect, where the queue is
 * about to be destroyed, so the timer is dropped rather than fired.
 */
export function mspCancelMotorTest(queue: MspSerialQueue): void {
  clearMotorTestStop(queue)
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

/**
 * Cut the motors and hold the cut. A single low-throttle frame lasts exactly
 * one frame, so the override latches and re-emits it; only arming releases it.
 */
export async function mspKillSwitch(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  if (!ctx.rc) return NO_RC_OVERRIDE
  const cut = ctx.rc.engageCut()
  if (!cut.ok) {
    return { success: false, resultCode: -1, message: `Motor cut refused: ${cut.reason}` }
  }
  return { success: true, resultCode: 0, message: 'Motor cut latched — held until the aircraft is armed again' }
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

// ── Navigation commands ─────────────────────────────────────

/**
 * Drive an iNav navigation mode by moving its AUX channel into the range the
 * aircraft has configured for it. This is how iNav selects a mode: there is no
 * direct set, which is why arming already works the same way.
 *
 * Both refusals are specific. A firmware without navigation modes says so, and
 * an aircraft that simply has no switch assigned to that mode names the mode,
 * because the operator's fix is to assign it in the modes tab.
 */
async function mspActivateNavMode(
  ctx: MspCommandContext,
  mode: UnifiedFlightMode,
  action: string,
): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  if (ctx.firmwareType !== 'inav') {
    return {
      success: false, resultCode: -1,
      message: `${action} is not available: this firmware has no navigation modes`,
    }
  }
  const boxId = MODE_TO_INAV_BOX[mode]
  if (boxId === undefined) {
    return {
      success: false, resultCode: -1,
      message: `${action} is not available: iNav has no mode for it`,
    }
  }
  const boxLabel = INAV_BOX_LABELS[boxId] ?? mode
  const range = findModeRange(ctx.modeRanges, boxId)
  if (!range) {
    return {
      success: false, resultCode: -1,
      message: `${action} is not available: no AUX switch is assigned to ${boxLabel} on this aircraft. Assign one in the modes tab, then retry.`,
    }
  }
  return mspSetAuxChannel(ctx, range.auxChannel, Math.round((range.rangeStart + range.rangeEnd) / 2))
}

export async function mspReturnToLaunch(ctx: MspCommandContext): Promise<CommandResult> {
  return mspActivateNavMode(ctx, 'RTL', 'Return to home')
}

export async function mspLand(ctx: MspCommandContext): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  if (ctx.firmwareType !== 'inav') return NOT_SUPPORTED
  // iNav has no standalone land box: the landing is the last leg of NAV RTH.
  // Quietly returning home under a "land" command would fly the aircraft
  // somewhere the operator did not ask for, so this refuses and says why.
  return {
    success: false, resultCode: -1,
    message: 'Land is not available: iNav has no separate landing mode. Use return to home, which lands at the home point.',
  }
}

export async function mspTakeoff(ctx: MspCommandContext, _alt?: number): Promise<CommandResult> {
  return mspActivateNavMode(ctx, 'TAKEOFF', 'Takeoff')
}

export async function mspGuidedGoto(
  ctx: MspCommandContext,
  _lat?: number,
  _lon?: number,
  _alt?: number,
): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  if (ctx.firmwareType !== 'inav') return NOT_SUPPORTED
  // A mode range switches a mode on; it cannot carry a coordinate. iNav takes
  // a target position only as an uploaded waypoint mission.
  return {
    success: false, resultCode: -1,
    message: 'Fly-to is not available: iNav takes a target position as an uploaded waypoint mission, not as a single command.',
  }
}

export async function mspPauseMission(ctx: MspCommandContext): Promise<CommandResult> {
  // Leaving the waypoint mode for position hold is how a mission is paused on
  // iNav; the mission resumes when waypoint mode is selected again.
  return mspActivateNavMode(ctx, 'POSHOLD', 'Pause')
}

export async function mspResumeMission(ctx: MspCommandContext): Promise<CommandResult> {
  return mspActivateNavMode(ctx, 'MISSION', 'Resume')
}

// Unsupported commands
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
  if (!ctx.rc) return NO_RC_OVERRIDE
  const write = ctx.rc.setAux(auxIndex, pwmValue)
  if (!write.ok) {
    return { success: false, resultCode: -1, message: `AUX${auxIndex + 1} write refused: ${write.reason}` }
  }
  return { success: true, resultCode: 0, message: `AUX${auxIndex + 1} set to ${pwmValue}` }
}
