/**
 * ArduPilot protocol capabilities and MAVLink enum constants.
 *
 * @module firmware/ardupilot-capabilities
 */

import type { ProtocolCapabilities } from '../types'

// ---------------------------------------------------------------------------
// MAVLink enum constants
// ---------------------------------------------------------------------------

/** MAV_AUTOPILOT enum subset (MAVLink common.xml) */
export const MAV_AUTOPILOT = {
  GENERIC: 0,
  ARDUPILOTMEGA: 3,
  PX4: 12,
} as const

/** MAV_TYPE enum subset (MAVLink common.xml) */
export const MAV_TYPE = {
  FIXED_WING: 1,
  QUADROTOR: 2,
  COAXIAL: 3,
  HELICOPTER: 4,
  GCS: 6,
  HEXAROTOR: 13,
  OCTOROTOR: 14,
  TRICOPTER: 15,
  VTOL_FIXEDROTOR: 22,
} as const

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Full ArduPilot capabilities shared by Plane and Copter */
export const ARDUPILOT_CAPABILITIES: ProtocolCapabilities = {
  supportsArming: true,
  supportsFlightModes: true,
  supportsMissionUpload: true,
  supportsMissionDownload: true,
  supportsManualControl: true,
  supportsParameters: true,
  supportsCalibration: true,
  supportsSerialPassthrough: true,
  supportsMotorTest: true,
  supportsGeoFence: true,
  supportsRally: true,
  supportsLogDownload: true,
  supportsOsd: true,
  supportsPidTuning: true,
  supportsPorts: true,
  supportsFailsafe: true,
  supportsPowerConfig: true,
  supportsReceiver: true,
  supportsFirmwareFlash: true,
  supportsCliShell: true,
  supportsMavlinkInspector: true,
  supportsGimbal: true,
  supportsCamera: true,
  supportsLed: true,
  supportsBattery2: true,
  supportsRangefinder: true,
  supportsOpticalFlow: true,
  supportsObstacleAvoidance: true,
  supportsDebugValues: true,
  supportsCanFrame: true,
  supportsAuxModes: false,
  supportsVtx: false,
  supportsBlackbox: false,
  supportsBetaflightConfig: false,
  supportsGpsConfig: false,
  supportsRateProfiles: false,
  supportsAdjustments: false,
  manualControlHz: 50,
  parameterCount: 1500,
}
