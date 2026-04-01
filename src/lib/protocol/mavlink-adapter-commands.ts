/**
 * MAVLink adapter — command methods (arm, disarm, takeoff, calibration, etc).
 * @module protocol/mavlink-adapter-commands
 */

import type { Transport, CommandResult, UnifiedFlightMode, FirmwareHandler } from './types'
import type { CommandQueue } from './command-queue'
import {
  encodeManualControl, encodeSetPositionTargetGlobalInt, encodeSetAttitudeTarget,
  encodeSerialControl, encodeCommandInt,
} from './mavlink-encoder'

export interface CommandContext {
  transport: Transport | null
  firmwareHandler: FirmwareHandler | null
  commandQueue: CommandQueue
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  sendCommandLong: (command: number, params: [number, number, number, number, number, number, number], timeoutMs?: number) => Promise<CommandResult>
}

export function cmdArm(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(400, [1, 0, 0, 0, 0, 0, 0])
}

export function cmdDisarm(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(400, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdSetFlightMode(ctx: CommandContext, mode: UnifiedFlightMode): Promise<CommandResult> {
  if (!ctx.firmwareHandler) {
    return Promise.resolve({ success: false, resultCode: -1, message: 'No firmware handler' })
  }
  const { baseMode, customMode } = ctx.firmwareHandler.encodeFlightMode(mode)
  return ctx.sendCommandLong(176, [baseMode, customMode, 0, 0, 0, 0, 0])
}

export function cmdReturnToLaunch(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(20, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdLand(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(21, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdTakeoff(ctx: CommandContext, altitude: number): Promise<CommandResult> {
  return ctx.sendCommandLong(22, [0, 0, 0, 0, 0, 0, altitude])
}

export function cmdSendManualControl(ctx: CommandContext, roll: number, pitch: number, throttle: number, yaw: number, buttons: number): void {
  if (!ctx.transport?.isConnected) return
  const x = Math.round(pitch * 1000)
  const y = Math.round(roll * 1000)
  const z = Math.round(throttle * 1000)
  const r = Math.round(yaw * 1000)
  ctx.transport.send(encodeManualControl(ctx.targetSysId, x, y, z, r, buttons, ctx.sysId, ctx.compId))
}

export function cmdStartCalibration(
  ctx: CommandContext,
  type: 'accel' | 'gyro' | 'compass' | 'level' | 'airspeed' | 'baro' | 'rc' | 'esc' | 'compassmot',
): Promise<CommandResult> {
  if (type === 'compass') {
    if (ctx.firmwareHandler?.firmwareType === 'px4') {
      return ctx.sendCommandLong(241, [0, 1, 0, 0, 0, 0, 0], 120000)
    }
    return ctx.sendCommandLong(42424, [0, 1, 0, 2, 0, 0, 0], 30000)
  }
  if (type === 'rc') {
    return Promise.resolve({ success: true, resultCode: 0, message: 'RC calibration ready — follow on-screen instructions' })
  }
  if (type === 'compassmot') {
    return ctx.sendCommandLong(241, [0, 0, 0, 0, 0, 1, 0], 120000)
  }
  const params: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0]
  switch (type) {
    case 'gyro':     params[0] = 1; break
    case 'accel':    params[4] = 1; break
    case 'level':    params[4] = 2; break
    case 'airspeed': params[5] = 2; break
    case 'baro':     params[2] = 1; break
    case 'esc':      params[6] = 1; break
  }
  return ctx.sendCommandLong(241, params, 30000)
}

export function cmdConfirmAccelCalPos(ctx: CommandContext, position: number): void {
  if (!ctx.transport?.isConnected) return
  ctx.commandQueue.sendCommandNoAck(
    42429, [position, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId,
  )
}

export function cmdAcceptCompassCal(ctx: CommandContext, compassMask = 0): Promise<CommandResult> {
  return ctx.sendCommandLong(42425, [compassMask, 0, 0, 0, 0, 0, 0])
}

export function cmdCancelCompassCal(ctx: CommandContext, compassMask = 0): Promise<CommandResult> {
  return ctx.sendCommandLong(42426, [compassMask, 0, 0, 0, 0, 0, 0])
}

export function cmdCancelCalibration(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(241, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdStartGnssMagCal(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(42006, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdSendCommand(ctx: CommandContext, commandId: number, params: number[]): Promise<CommandResult> {
  const p: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < Math.min(7, params.length); i++) p[i] = params[i]
  return ctx.sendCommandLong(commandId, p)
}

export function cmdMotorTest(ctx: CommandContext, motor: number, throttle: number, duration: number): Promise<CommandResult> {
  return ctx.sendCommandLong(209, [motor, 0, throttle, duration, 0, 0, 0])
}

export function cmdRebootToBootloader(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.commandQueue.sendCommandNoAck(
    246, [3, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return { success: true, resultCode: 0, message: 'Bootloader reboot command sent' }
}

export function cmdReboot(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.commandQueue.sendCommandNoAck(
    246, [1, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return { success: true, resultCode: 0, message: 'Reboot command sent' }
}

export function cmdResetParametersToDefault(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.commandQueue.sendCommandNoAck(
    245, [2, -1, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return { success: true, resultCode: 0, message: 'Reset command sent' }
}

export function cmdKillSwitch(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(185, [1, 0, 0, 0, 0, 0, 0])
}

export function cmdGuidedGoto(ctx: CommandContext, lat: number, lon: number, alt: number): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  const frame = encodeCommandInt(
    ctx.targetSysId, ctx.targetCompId, 6, 192, 0, 0,
    -1, 1, 0, 0,
    Math.round(lat * 1e7), Math.round(lon * 1e7), alt,
    ctx.sysId, ctx.compId,
  )
  ctx.transport.send(frame)
  return { success: true, resultCode: 0, message: 'Goto sent' }
}

export function cmdPauseMission(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(193, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdResumeMission(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(193, [1, 0, 0, 0, 0, 0, 0])
}

export function cmdCommitParamsToFlash(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.commandQueue.sendCommandNoAck(
    245, [1, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return { success: true, resultCode: 0, message: 'Flash commit command sent' }
}

export function cmdSetHome(ctx: CommandContext, useCurrent: boolean, lat = 0, lon = 0, alt = 0): Promise<CommandResult> {
  if (!useCurrent && ctx.firmwareHandler?.firmwareType === 'px4') {
    return Promise.resolve({ success: false, resultCode: 4, message: 'PX4 uses EKF origin for home position — only "use current" is supported' })
  }
  return ctx.sendCommandLong(179, [useCurrent ? 1 : 0, 0, 0, 0, lat, lon, alt])
}

export function cmdChangeSpeed(ctx: CommandContext, speedType: number, speed: number): Promise<CommandResult> {
  return ctx.sendCommandLong(178, [speedType, speed, -1, 0, 0, 0, 0])
}

export function cmdSetYaw(ctx: CommandContext, angle: number, speed: number, direction: number, relative: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(115, [angle, speed, direction, relative ? 1 : 0, 0, 0, 0])
}

export function cmdSetGeoFenceEnabled(ctx: CommandContext, enabled: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(207, [enabled ? 1 : 0, 0, 0, 0, 0, 0, 0])
}

export function cmdSetServo(ctx: CommandContext, servoNumber: number, pwm: number): Promise<CommandResult> {
  return ctx.sendCommandLong(183, [servoNumber, pwm, 0, 0, 0, 0, 0])
}

export function cmdCameraTrigger(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(203, [0, 0, 0, 0, 1, 0, 0])
}

export function cmdSetGimbalAngle(ctx: CommandContext, pitch: number, roll: number, yaw: number): Promise<CommandResult> {
  return ctx.sendCommandLong(205, [pitch * 100, roll * 100, yaw * 100, 0, 0, 0, 0])
}

export function cmdSetGimbalMode(ctx: CommandContext, mode: number): Promise<CommandResult> {
  return ctx.sendCommandLong(204, [mode, 0, 0, 0, 0, 0, 0])
}

export function cmdDoPreArmCheck(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(401, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdEnableFence(ctx: CommandContext, enable: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(217, [enable ? 1 : 0, 0, 0, 0, 0, 0, 0])
}

export function cmdDoLandStart(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(189, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdControlVideo(ctx: CommandContext, params: { cameraId: number; transmission: number; channel: number; recording: number }): Promise<CommandResult> {
  return ctx.sendCommandLong(200, [params.cameraId, params.transmission, params.channel, params.recording, 0, 0, 0])
}

export function cmdSetRelay(ctx: CommandContext, relayNum: number, on: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(186, [relayNum, on ? 1 : 0, 0, 0, 0, 0, 0])
}

export function cmdStartRxPair(ctx: CommandContext, spektrum: number): Promise<CommandResult> {
  return ctx.sendCommandLong(243, [spektrum, 0, 0, 0, 0, 0, 0])
}

export function cmdRequestMessage(ctx: CommandContext, msgId: number): Promise<CommandResult> {
  return ctx.sendCommandLong(512, [msgId, 0, 0, 0, 0, 0, 0])
}

export function cmdSetMessageInterval(ctx: CommandContext, msgId: number, intervalUs: number): Promise<CommandResult> {
  return ctx.sendCommandLong(511, [msgId, intervalUs, 0, 0, 0, 0, 0])
}

export function cmdStartCompassMotCal(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(241, [0, 0, 0, 0, 0, 1, 0], 120000)
}

export function cmdSendSerialData(ctx: CommandContext, text: string): void {
  if (!ctx.transport?.isConnected) return
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text + '\n')
  ctx.transport.send(encodeSerialControl(10, 6, 500, 0, bytes, ctx.sysId, ctx.compId))
}

export function cmdSendPositionTarget(ctx: CommandContext, lat: number, lon: number, alt: number): void {
  if (!ctx.transport?.isConnected) return
  ctx.transport.send(encodeSetPositionTargetGlobalInt(
    ctx.targetSysId, ctx.targetCompId,
    Math.round(lat * 1e7), Math.round(lon * 1e7), alt,
    0, 0, 0, 0x0FF8, 6, ctx.sysId, ctx.compId,
  ))
}

export function cmdSendAttitudeTarget(ctx: CommandContext, roll: number, pitch: number, yaw: number, thrust: number): void {
  if (!ctx.transport?.isConnected) return
  ctx.transport.send(encodeSetAttitudeTarget(
    ctx.targetSysId, ctx.targetCompId,
    roll, pitch, yaw, thrust, 0x07, ctx.sysId, ctx.compId,
  ))
}

/** MAV_CMD_DO_SET_ROI_LOCATION (195) — point gimbal at GPS coordinate. Uses COMMAND_INT. */
export function cmdSetRoiLocation(ctx: CommandContext, lat: number, lon: number, alt: number): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  const frame = encodeCommandInt(
    ctx.targetSysId, ctx.targetCompId, 0, 195, 0, 0,
    0, 0, 0, 0,
    Math.round(lat * 1e7), Math.round(lon * 1e7), alt,
    ctx.sysId, ctx.compId,
  )
  ctx.transport.send(frame)
  return { success: true, resultCode: 0, message: 'ROI location set' }
}

/** MAV_CMD_DO_SET_ROI_NONE (197) — clear gimbal ROI targeting. */
export function cmdSetRoiNone(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(197, [0, 0, 0, 0, 0, 0, 0])
}

/** MAV_CMD_DO_ORBIT (34) — orbit at GPS coordinate. Uses COMMAND_INT. */
export function cmdOrbit(ctx: CommandContext, radius: number, velocity: number, yawBehavior: number, lat: number, lon: number, alt: number): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  // yawBehavior: 0=HOLD, 1=UNCONTROLLED, 2=FRONT_TO_CENTER, 3=RC_CONTROLLED
  const frame = encodeCommandInt(
    ctx.targetSysId, ctx.targetCompId, 6, 34, 0, 0,
    radius, velocity, yawBehavior, 0,
    Math.round(lat * 1e7), Math.round(lon * 1e7), alt,
    ctx.sysId, ctx.compId,
  )
  ctx.transport.send(frame)
  return { success: true, resultCode: 0, message: 'Orbit command sent' }
}

/** MAV_CMD_SET_GPS_GLOBAL_ORIGIN (48) — set EKF origin. Uses COMMAND_INT. */
export function cmdSetEkfOrigin(ctx: CommandContext, lat: number, lon: number, alt: number): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  const frame = encodeCommandInt(
    ctx.targetSysId, ctx.targetCompId, 0, 48, 0, 0,
    0, 0, 0, 0,
    Math.round(lat * 1e7), Math.round(lon * 1e7), alt,
    ctx.sysId, ctx.compId,
  )
  ctx.transport.send(frame)
  return { success: true, resultCode: 0, message: 'EKF origin set' }
}

