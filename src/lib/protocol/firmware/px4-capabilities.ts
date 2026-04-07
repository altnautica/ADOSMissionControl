/**
 * PX4 protocol capabilities and vehicle class detection.
 *
 * @module firmware/px4-capabilities
 */

import type { ProtocolCapabilities, VehicleClass } from '../types'

// TODO: PX4 Component Metadata Protocol (MAVLink FTP) — deferred, LOW priority
// PX4 supports downloading parameter metadata via MAVLink FTP protocol.
// This would enable parameter descriptions, valid ranges, and units in the UI.
// For now, supportsParamMetadata is not in ProtocolCapabilities; add when implemented.

export const PX4_CAPABILITIES: ProtocolCapabilities = {
  supportsArming: true,
  supportsFlightModes: true,
  supportsMissionUpload: true,
  supportsMissionDownload: true,
  supportsManualControl: true,
  supportsParameters: true,
  supportsCalibration: true,
  supportsSerialPassthrough: false,
  supportsMotorTest: true,
  supportsGeoFence: true,
  supportsRally: false,
  supportsLogDownload: true,
  supportsOsd: false,
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
  supportsLed: false,
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
  parameterCount: 1000,
}

/** Map MAV_TYPE enum to vehicle class for PX4. */
export function px4VehicleClassFromMavType(mavType: number): VehicleClass {
  switch (mavType) {
    // Fixed wing / VTOL
    case 1:   // FIXED_WING
    case 22:  // VTOL_FIXEDROTOR
    case 23:  // VTOL_TAILSITTER
    case 24:  // VTOL_TILTROTOR
    case 25:  // VTOL_RESERVED2
    case 26:  // VTOL_RESERVED3
    case 27:  // VTOL_RESERVED4
    case 28:  // VTOL_RESERVED5
      return 'plane'
    // Multirotor
    case 2:   // QUADROTOR
    case 3:   // COAXIAL
    case 4:   // HELICOPTER
    case 13:  // HEXAROTOR
    case 14:  // OCTOROTOR
    case 15:  // TRICOPTER
      return 'copter'
    // Ground
    case 10:  // GROUND_ROVER
      return 'rover'
    // Sub
    case 12:  // SUBMARINE
      return 'sub'
    default:
      return 'copter'
  }
}

/** Standard message for PX4-unsupported panel placeholders. */
export const PX4_UNSUPPORTED_MESSAGE = 'This feature is not available for PX4 firmware.'
