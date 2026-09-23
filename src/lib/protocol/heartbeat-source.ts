/**
 * Which HEARTBEATs speak for the flight controller.
 *
 * Every MAVLink component on a vehicle (companion computer, gimbal, camera,
 * ADS-B receiver, OSD, ...) sends its own HEARTBEAT on the vehicle's system
 * id. Only the autopilot's heartbeat carries the armed flag and flight mode,
 * so only it may lock the connection target or drive armed/mode/link state.
 *
 * @module protocol/heartbeat-source
 * @license GPL-3.0-only
 */

import type { MAVLinkFrame } from './mavlink-parser'
import type { FrameHandlerState } from './mavlink-adapter-frame-handlers'
import { decodeHeartbeat } from './mavlink-messages'

/** MAV_AUTOPILOT_INVALID: the sender is not a flight controller. */
const MAV_AUTOPILOT_INVALID = 8

/** MAV_TYPE values of components that are not the vehicle itself. */
const NON_VEHICLE_MAV_TYPES: ReadonlySet<number> = new Set([
  6, // GCS
  18, // ONBOARD_CONTROLLER
  26, // GIMBAL
  27, // ADSB
  30, // CAMERA
  31, // CHARGING_STATION
  32, // FLARM
  33, // SERVO
  34, // ODID
  36, // BATTERY
  37, // PARACHUTE
  38, // LOG
  39, // OSD
  40, // IMU
  41, // GPS
  42, // WINCH
  44, // ILLUMINATOR
])

/** True when a HEARTBEAT comes from a flight controller, not a peripheral or GCS. */
export function isAutopilotHeartbeat(hb: { type: number; autopilot: number }): boolean {
  return hb.autopilot !== MAV_AUTOPILOT_INVALID && !NON_VEHICLE_MAV_TYPES.has(hb.type)
}

/**
 * Route a HEARTBEAT (msg 0). Only the locked autopilot component drives
 * armed/mode state and refreshes the link timer: a companion computer's
 * heartbeat (base_mode 0, AUTOPILOT_INVALID) on the same system id would
 * otherwise read as a disarm.
 */
export function handleHeartbeat(s: FrameHandlerState, frame: MAVLinkFrame): void {
  if (frame.systemId !== s.targetSysId || frame.componentId !== s.targetCompId) return
  const hb = decodeHeartbeat(frame.payload)
  if (!isAutopilotHeartbeat(hb)) return
  s.lastVehicleHeartbeat = Date.now()
  const armed = (hb.baseMode & 0x80) !== 0
  const mode = s.firmwareHandler?.decodeFlightMode(hb.customMode) ?? 'UNKNOWN'
  for (const cb of s.cbs.heartbeatCallbacks) {
    cb({ armed, mode, systemStatus: hb.systemStatus, vehicleInfo: s.vehicleInfo! })
  }
}
