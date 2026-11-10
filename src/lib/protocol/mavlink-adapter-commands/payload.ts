/**
 * MAVLink adapter commands: servo, camera, gimbal, ROI, video, relay and RX pairing.
 * @module protocol/mavlink-adapter-commands/payload
 */

import type { CommandResult } from '../types'
import type { CommandContext } from './context'
import { MAV_MOUNT_MODE_MAVLINK_TARGETING } from './context'

export function cmdSetServo(ctx: CommandContext, servoNumber: number, pwm: number): Promise<CommandResult> {
  return ctx.sendCommandLong(183, [servoNumber, pwm, 0, 0, 0, 0, 0])
}

export function cmdCameraTrigger(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(203, [0, 0, 0, 0, 1, 0, 0])
}

/** CAMERA_ZOOM_TYPE ZOOM_TYPE_STEP: param2 is a step direction (1 in, -1 out). */
const ZOOM_TYPE_STEP = 0

/**
 * MAV_CMD_IMAGE_START_CAPTURE (2000): one image from every camera on
 * `cameraCompId` (id 0, no interval, one image, no sequence number).
 */
export function cmdImageStartCapture(ctx: CommandContext, cameraCompId?: number): Promise<CommandResult> {
  return ctx.sendCommandLong(2000, [0, 0, 1, 0, 0, 0, 0], undefined, cameraCompId)
}

/** MAV_CMD_SET_CAMERA_ZOOM (531), one step in (1) or out (-1). */
export function cmdSetCameraZoom(ctx: CommandContext, step: 1 | -1, cameraCompId?: number): Promise<CommandResult> {
  return ctx.sendCommandLong(531, [ZOOM_TYPE_STEP, step, 0, 0, 0, 0, 0], undefined, cameraCompId)
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
export function cmdControlVideo(ctx: CommandContext, params: { cameraId: number; transmission: number; channel: number; recording: number }): Promise<CommandResult> {
  return ctx.sendCommandLong(200, [params.cameraId, params.transmission, params.channel, params.recording, 0, 0, 0])
}

export function cmdSetRelay(ctx: CommandContext, relayNum: number, on: boolean): Promise<CommandResult> {
  return ctx.sendCommandLong(181, [relayNum, on ? 1 : 0, 0, 0, 0, 0, 0]) // MAV_CMD_DO_SET_RELAY
}

export function cmdStartRxPair(ctx: CommandContext, spektrum: number): Promise<CommandResult> {
  // MAV_CMD_START_RX_PAIR (500). This used to send 243, which is
  // MAV_CMD_PREFLIGHT_UAVCAN — whose param1 = 1 triggers a one-time DroneCAN
  // actuator ID assignment and direction mapping. Pressing "bind receiver"
  // re-enumerated the CAN actuators instead of binding anything.
  return ctx.sendCommandLong(500, [spektrum, 0, 0, 0, 0, 0, 0])
}
/**
 * MAV_CMD_DO_SET_ROI_LOCATION (195) — point gimbal at a GPS coordinate.
 *
 * Ack-tracked COMMAND_INT: it previously wrote the frame to the transport and
 * returned `success: true` for the WRITE, so a rejected or unsupported ROI read
 * as accepted on the gimbal surface.
 */
export function cmdSetRoiLocation(ctx: CommandContext, lat: number, lon: number, alt: number): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
  }
  return ctx.sendCommandInt(
    195,
    [0, 0, 0, 0],
    Math.round(lat * 1e7),
    Math.round(lon * 1e7),
    alt,
    0, // MAV_FRAME_GLOBAL
  )
}

/** MAV_CMD_DO_SET_ROI_NONE (197) — clear gimbal ROI targeting. */
export function cmdSetRoiNone(ctx: CommandContext): Promise<CommandResult> {
  return ctx.sendCommandLong(197, [0, 0, 0, 0, 0, 0, 0])
}
