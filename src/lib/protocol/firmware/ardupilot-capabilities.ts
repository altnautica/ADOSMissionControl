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
  supportsAutonomousNav: true,
  supportsGeoFence: true,
  supportsRally: true,
  supportsLogDownload: true,
  supportsOsd: true,
  supportsDisplayPort: false,
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
  supportsMspMotors: false,
  supportsGpsConfig: true,
  supportsEkfConfig: true,
  supportsStreamRates: true,
  supportsVtolConfig: true,
  supportsTecsConfig: true,
  supportsSubConfig: true,
  supportsPx4Tuning: false,
  supportsRateProfiles: false,
  supportsAdjustments: false,
  // MAVLink signing is strictly conditional: the adapter checks for
  // SIGNING_* params before flipping this flag to true at runtime.
  // Defaults to true here because ArduPilot 4.0+ is the primary target
  // and the runtime check will downgrade old or stripped builds.
  supportsMavlinkSigning: true,
  // iNav-specific capabilities
  supportsMultiMission: false,
  supportsSafehome: false,
  supportsGeozone: false,
  supportsLogicConditions: false,
  supportsGlobalVariables: false,
  supportsProgrammingPid: false,
  supportsEzTune: false,
  supportsFwApproach: false,
  supportsCustomOsd: false,
  supportsMixerProfile: false,
  supportsBatteryProfile: false,
  supportsTempSensors: false,
  supportsServoMixer: false,
  supportsOutputMappingExt: false,
  supportsRateDynamics: false,
  supportsMcBraking: false,
  supportsSettings: false,
  supportsCliSettings: false,
  manualControlHz: 50,
  parameterCount: 1500,
}
