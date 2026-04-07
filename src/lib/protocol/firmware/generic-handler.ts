/**
 * Generic (fallback) firmware handler for unrecognised autopilots.
 *
 * All mode operations return UNKNOWN. Capabilities report nothing supported.
 *
 * @module firmware/generic-handler
 */

import type {
  FirmwareHandler,
  FirmwareType,
  UnifiedFlightMode,
  VehicleClass,
  ProtocolCapabilities,
} from '../types'

const GENERIC_CAPABILITIES: ProtocolCapabilities = {
  supportsArming: false,
  supportsFlightModes: false,
  supportsMissionUpload: false,
  supportsMissionDownload: false,
  supportsManualControl: false,
  supportsParameters: false,
  supportsCalibration: false,
  supportsSerialPassthrough: false,
  supportsMotorTest: false,
  supportsGeoFence: false,
  supportsRally: false,
  supportsLogDownload: false,
  supportsOsd: false,
  supportsPidTuning: false,
  supportsPorts: false,
  supportsFailsafe: false,
  supportsPowerConfig: false,
  supportsReceiver: false,
  supportsFirmwareFlash: false,
  supportsCliShell: false,
  supportsMavlinkInspector: false,
  supportsGimbal: false,
  supportsCamera: false,
  supportsLed: false,
  supportsBattery2: false,
  supportsRangefinder: false,
  supportsOpticalFlow: false,
  supportsObstacleAvoidance: false,
  supportsDebugValues: false,
  supportsCanFrame: false,
  supportsAuxModes: false,
  supportsVtx: false,
  supportsBlackbox: false,
  supportsBetaflightConfig: false,
  supportsGpsConfig: false,
  supportsRateProfiles: false,
  supportsAdjustments: false,
  manualControlHz: 0,
  parameterCount: 0,
}

export class GenericHandler implements FirmwareHandler {
  readonly firmwareType: FirmwareType = 'unknown'
  readonly vehicleClass: VehicleClass = 'copter'

  encodeFlightMode(_mode: UnifiedFlightMode): { baseMode: number; customMode: number } {
    return { baseMode: 1, customMode: 0 }
  }

  decodeFlightMode(_customMode: number): UnifiedFlightMode {
    return 'UNKNOWN'
  }

  getAvailableModes(): UnifiedFlightMode[] {
    return ['UNKNOWN']
  }

  getDefaultMode(): UnifiedFlightMode {
    return 'UNKNOWN'
  }

  getCapabilities(): ProtocolCapabilities {
    return GENERIC_CAPABILITIES
  }

  getFirmwareVersion(): string {
    return 'Unknown'
  }

  mapParameterName(canonical: string): string {
    return canonical
  }

  reverseMapParameterName(firmwareName: string): string {
    return firmwareName
  }
}
