/**
 * MAVLink adapter — command methods (arm, disarm, takeoff, calibration, etc).
 * @module protocol/mavlink-adapter-commands
 */

import type { Transport, CommandResult, UnifiedFlightMode, FirmwareHandler } from './types'
import type { CommandQueue } from './command-queue'
import {
  encodeManualControl, encodeSetPositionTargetGlobalInt, encodeSetAttitudeTarget,
  encodeSerialControl, encodeCommandInt, encodeSetGpsGlobalOrigin,
} from './mavlink-encoder'

/**
 * `MAV_MOUNT_MODE_MAVLINK_TARGETING` — the only mount mode under which
 * DO_MOUNT_CONTROL's pitch/roll/yaw params mean anything. Named because the
 * default 0 is `RETRACT`, and passing it while commanding an angle stows the
 * gimbal, which is not a mistake a magic number makes obvious.
 */
const MAV_MOUNT_MODE_MAVLINK_TARGETING = 2

/**
 * Whether ArduPilot's vendor calibration commands (the 424xx and 42006 range)
 * can be sent to whatever is connected.
 *
 * They were sent unconditionally. On PX4 they return UNSUPPORTED and the
 * calibration UI waits on an ack that means nothing, so the operator sees a
 * wizard that hangs rather than a surface that says the vehicle cannot do it.
 *
 * Gated on `fcVariant`, never on link liveness: a firmware that is present but
 * not the one assumed is exactly the case that shows confident wrong data.
 */
function isArduPilot(ctx: CommandContext): boolean {
  // The union is per-vehicle-class: ardupilot-copter / -plane / -rover / -sub.
  return ctx.firmwareHandler?.firmwareType?.startsWith('ardupilot') ?? false
}

function refuseNonArduPilot(ctx: CommandContext, what: string): CommandResult {
  const variant = ctx.firmwareHandler?.firmwareType ?? 'unknown'
  return {
    success: false,
    resultCode: 3, // MAV_RESULT_UNSUPPORTED
    message: `${what} is an ArduPilot vendor command; connected firmware is ${variant}`,
  }
}

export interface CommandContext {
  transport: Transport | null
  firmwareHandler: FirmwareHandler | null
  commandQueue: CommandQueue
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  sendCommandLong: (command: number, params: [number, number, number, number, number, number, number], timeoutMs?: number) => Promise<CommandResult>
  /** Ack-tracked COMMAND_INT, for commands whose x/y need 1e7 integer precision. */
  sendCommandInt: (
    command: number,
    params: [number, number, number, number],
    x: number,
    y: number,
    z: number,
    frame: number,
    timeoutMs?: number,
  ) => Promise<CommandResult>
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
  // PX4 reads DO_SET_MODE with the two mode levels de-packed: param2 = main_mode,
  // param3 = sub_mode. It casts the low byte of param2 to the main mode, so the
  // packed custom_mode value would be read as main 0 and rejected. The packed
  // layout (main in bits 16-23, sub in bits 24-31) is only for the custom_mode
  // field (HEARTBEAT / SET_MODE), not this command. ArduPilot keeps the flat
  // custom_mode number in param2.
  if (ctx.firmwareHandler.firmwareType === 'px4') {
    const mainMode = (customMode >>> 16) & 0xff
    const subMode = (customMode >>> 24) & 0xff
    return ctx.sendCommandLong(176, [baseMode, mainMode, subMode, 0, 0, 0, 0])
  }
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

/**
 * MANUAL_CONTROL from a normalized stick frame. Roll, pitch, and yaw are -1..1
 * and map to the full -1000..1000 axis range. Throttle is 0..1 and maps to
 * 0..1000, the range the message defines for a vehicle with no reverse thrust.
 */
export function cmdSendManualControl(ctx: CommandContext, roll: number, pitch: number, throttle: number, yaw: number, buttons: number): void {
  if (!ctx.transport?.isConnected) return
  const clampAxis = (v: number) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0))
  const x = Math.round(clampAxis(pitch) * 1000)
  const y = Math.round(clampAxis(roll) * 1000)
  const z = Math.round(Math.max(0, Math.min(1, Number.isFinite(throttle) ? throttle : 0)) * 1000)
  const r = Math.round(clampAxis(yaw) * 1000)
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
    // PREFLIGHT_CALIBRATION param6 is ArduPilot's CompassMot slot; on other
    // firmware the command is accepted and does nothing recognisable.
    if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'CompassMot calibration'))
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
  if (!isArduPilot(ctx)) return
  ctx.commandQueue.sendCommandNoAck(
    42429, [position, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId,
  )
}

export function cmdAcceptCompassCal(ctx: CommandContext, compassMask = 0): Promise<CommandResult> {
  if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'Accept compass calibration'))
  return ctx.sendCommandLong(42425, [compassMask, 0, 0, 0, 0, 0, 0])
}

export function cmdCancelCompassCal(ctx: CommandContext, compassMask = 0): Promise<CommandResult> {
  if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'Cancel compass calibration'))
  return ctx.sendCommandLong(42426, [compassMask, 0, 0, 0, 0, 0, 0])
}

export function cmdCancelCalibration(ctx: CommandContext): Promise<CommandResult> {
  // PREFLIGHT_CALIBRATION with all-zero params is the standard cancel across
  // every firmware, so this one is deliberately not gated.
  return ctx.sendCommandLong(241, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdStartGnssMagCal(ctx: CommandContext): Promise<CommandResult> {
  if (!isArduPilot(ctx)) return Promise.resolve(refuseNonArduPilot(ctx, 'GNSS/mag calibration'))
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
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Bootloader reboot command sent, unacknowledged',
  }
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
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Reboot command sent, unacknowledged',
  }
}

export function cmdResetParametersToDefault(ctx: CommandContext): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  // MAV_CMD_PREFLIGHT_STORAGE (245). param1 = 2 resets parameter storage to
  // defaults; param2 is the MISSION storage action and 0 means "no action".
  // It used to pass -1, which is outside the enum — a receiver is free to
  // interpret that however it likes, including wiping the mission.
  ctx.commandQueue.sendCommandNoAck(
    245, [2, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Reset command sent, unacknowledged',
  }
}

/**
 * MAV_CMD_DO_FLIGHTTERMINATION. Irreversible in flight: it cuts the outputs
 * and the airframe falls.
 *
 * The protocol layer will not guess whether an operator meant it, so the
 * confirmation is the CALLER's job and this signature makes that explicit
 * rather than accepting a bare click. `confirmed` must come from a real
 * operator confirmation (the armed-write confirm dialog), never a default.
 */
export function cmdKillSwitch(ctx: CommandContext, confirmed: boolean): Promise<CommandResult> {
  if (!confirmed) {
    return Promise.resolve({
      success: false,
      resultCode: -1,
      message: 'Flight termination requires explicit confirmation',
    })
  }
  return ctx.sendCommandLong(185, [1, 0, 0, 0, 0, 0, 0])
}

export function cmdGuidedGoto(ctx: CommandContext, lat: number, lon: number, alt: number): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
  }
  // MAV_CMD_DO_REPOSITION (192) as a COMMAND_INT so lat/lon keep 1e7 integer
  // precision. It used to be a raw transport write that reported success on
  // the WRITE, so a rejected or unsupported reposition read as accepted; it is
  // ack-tracked now like every other flight-affecting command.
  return ctx.sendCommandInt(
    192,
    [-1, 1, 0, 0],
    Math.round(lat * 1e7),
    Math.round(lon * 1e7),
    alt,
    6, // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
  )
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
  // Deliberately fire-and-forget: ArduPilot writes PARAM_SET straight to
  // EEPROM, so this is a belt-and-braces PREFLIGHT_STORAGE and no caller may
  // block on its ack. What was wrong is the RETURN VALUE — an unconditional
  // `success: true` that surfaces rendered as "written to flash" for a write
  // nothing confirmed. `acknowledged: false` is the honest shape; do not add
  // an ack wait here.
  ctx.commandQueue.sendCommandNoAck(
    245, [1, 0, 0, 0, 0, 0, 0],
    (data) => ctx.transport!.send(data),
    ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId,
  )
  return {
    success: true,
    resultCode: 0,
    acknowledged: false,
    message: 'Flash commit command sent, unacknowledged',
  }
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
  // MAV_CMD_DO_MOUNT_CONTROL (205) takes float DEGREES for pitch/roll/yaw.
  // (The centidegree convention belongs to the deprecated MOUNT_CONTROL
  // message, not this command.)
  //
  // param7 is the MOUNT MODE, and it was left at 0 — MAV_MOUNT_MODE_RETRACT.
  // Commanding an angle therefore STOWED the gimbal instead of pointing it.
  // MAVLINK_TARGETING (2) is the mode that makes params 1-3 mean anything.
  return ctx.sendCommandLong(205, [pitch, roll, yaw, 0, 0, 0, MAV_MOUNT_MODE_MAVLINK_TARGETING])
}

export function cmdSetGimbalMode(ctx: CommandContext, mode: number): Promise<CommandResult> {
  return ctx.sendCommandLong(204, [mode, 0, 0, 0, 0, 0, 0])
}

export function cmdDoPreArmCheck(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(401, [0, 0, 0, 0, 0, 0, 0])
}

export function cmdEnableFence(ctx: CommandContext, enable: boolean): Promise<CommandResult> {
  // One implementation, one command number. This used to send 217, which is
  // not in the MAV_CMD enum at all, while cmdSetGeoFenceEnabled sent the real
  // MAV_CMD_DO_FENCE_ENABLE (207) for the same operator intent.
  return cmdSetGeoFenceEnabled(ctx, enable)
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
  // MAV_CMD_START_RX_PAIR (500). This used to send 243, which is
  // MAV_CMD_PREFLIGHT_UAVCAN — whose param1 = 1 triggers a one-time DroneCAN
  // actuator ID assignment and direction mapping. Pressing "bind receiver"
  // re-enumerated the CAN actuators instead of binding anything.
  return ctx.sendCommandLong(500, [spektrum, 0, 0, 0, 0, 0, 0])
}

export function cmdRequestMessage(ctx: CommandContext, msgId: number): Promise<CommandResult> {
  return ctx.sendCommandLong(512, [msgId, 0, 0, 0, 0, 0, 0])
}

export function cmdSetMessageInterval(ctx: CommandContext, msgId: number, intervalUs: number): Promise<CommandResult> {
  return ctx.sendCommandLong(511, [msgId, intervalUs, 0, 0, 0, 0, 0])
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

/**
 * SET_GPS_GLOBAL_ORIGIN (message 48) — set the EKF origin.
 *
 * 48 is a MAVLink message, not a MAV_CMD, so the flight controller adopts the
 * origin on receipt without returning a COMMAND_ACK. The result reports only
 * whether the message left the transport; there is no confirmation that the
 * origin was accepted.
 */
export function cmdSetEkfOrigin(ctx: CommandContext, lat: number, lon: number, alt: number): CommandResult {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  const frame = encodeSetGpsGlobalOrigin(
    ctx.targetSysId,
    Math.round(lat * 1e7), Math.round(lon * 1e7), Math.round(alt * 1000),
    ctx.sysId, ctx.compId,
  )
  try {
    ctx.transport.send(frame)
  } catch (err) {
    return { success: false, resultCode: -1, message: `Send failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { success: true, resultCode: 0, message: 'EKF origin sent (unconfirmed; no ACK for this message)' }
}

