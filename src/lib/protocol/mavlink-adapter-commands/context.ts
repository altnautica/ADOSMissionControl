/**
 * MAVLink adapter commands: shared command context and firmware gates.
 * @module protocol/mavlink-adapter-commands/context
 */

import type { Transport, CommandResult, FirmwareHandler } from '../types'
import type { CommandQueue } from '../command-queue'

/**
 * `MAV_MOUNT_MODE_MAVLINK_TARGETING` — the only mount mode under which
 * DO_MOUNT_CONTROL's pitch/roll/yaw params mean anything. Named because the
 * default 0 is `RETRACT`, and passing it while commanding an angle stows the
 * gimbal, which is not a mistake a magic number makes obvious.
 */
export const MAV_MOUNT_MODE_MAVLINK_TARGETING = 2

/** MAV_FRAME_GLOBAL: WGS84 latitude/longitude, altitude AMSL. */
export const MAV_FRAME_GLOBAL = 0

/**
 * Whether ArduPilot's vendor calibration commands (the 424xx range) can be
 * sent to whatever is connected.
 *
 * They were sent unconditionally. On PX4 they return UNSUPPORTED and the
 * calibration UI waits on an ack that means nothing, so the operator sees a
 * wizard that hangs rather than a surface that says the vehicle cannot do it.
 *
 * Gated on `fcVariant`, never on link liveness: a firmware that is present but
 * not the one assumed is exactly the case that shows confident wrong data.
 */
export function isArduPilot(ctx: CommandContext): boolean {
  // The union is per-vehicle-class: ardupilot-copter / -plane / -rover / -sub.
  return ctx.firmwareHandler?.firmwareType?.startsWith('ardupilot') ?? false
}

export function refuseNonArduPilot(ctx: CommandContext, what: string): CommandResult {
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
  /**
   * The vehicle's home altitude AMSL in metres from its last HOME_POSITION,
   * or null before one has arrived. PX4 reads several altitude params as
   * AMSL, so a height above home has to be converted with it.
   */
  homeAltitudeAmsl: number | null
  /** Ack-tracked COMMAND_LONG to `targetCompId`, the autopilot's component when omitted. */
  sendCommandLong: (command: number, params: [number, number, number, number, number, number, number], timeoutMs?: number, targetCompId?: number) => Promise<CommandResult>
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
