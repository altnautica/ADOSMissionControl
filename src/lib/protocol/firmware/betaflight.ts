/**
 * Betaflight firmware handler for Altnautica Command GCS.
 *
 * Betaflight uses the MSP (MultiWii Serial Protocol). This handler
 * provides capability reporting, mode encoding/decoding, and parameter
 * name mapping for the UI.
 *
 * @module firmware/betaflight
 */

import type {
  FirmwareType,
  FirmwareHandler,
  UnifiedFlightMode,
  VehicleClass,
  ProtocolCapabilities,
} from '../types'

// ---------------------------------------------------------------------------
// Betaflight capabilities
// ---------------------------------------------------------------------------

const BETAFLIGHT_CAPABILITIES: ProtocolCapabilities = {
  supportsArming: true,
  supportsFlightModes: true,
  supportsMissionUpload: false,
  supportsMissionDownload: false,
  supportsManualControl: true,
  supportsParameters: true,
  supportsCalibration: true,
  supportsSerialPassthrough: true,
  supportsMotorTest: true,
  supportsGeoFence: false,
  supportsRally: false,
  supportsLogDownload: true,
  supportsOsd: true,
  supportsPidTuning: true,
  supportsPorts: true,
  supportsFailsafe: true,
  supportsPowerConfig: true,
  supportsReceiver: true,
  supportsFirmwareFlash: true,
  supportsCliShell: true,
  supportsMavlinkInspector: false,
  supportsGimbal: false,
  supportsCamera: false,
  supportsLed: true,
  supportsBattery2: false,
  supportsRangefinder: false,
  supportsOpticalFlow: false,
  supportsObstacleAvoidance: false,
  supportsDebugValues: true,
  supportsCanFrame: false,
  supportsAuxModes: true,
  supportsVtx: true,
  supportsBlackbox: true,
  supportsBetaflightConfig: true,
  supportsGpsConfig: true,
  supportsRateProfiles: true,
  supportsAdjustments: true,
  manualControlHz: 50,
  parameterCount: 300,
}

// ---------------------------------------------------------------------------
// BetaflightHandler
// ---------------------------------------------------------------------------

/**
 * Firmware handler for Betaflight.
 *
 * Betaflight mode switching is done via AUX channels, not MAVLink-style
 * commands. encodeFlightMode returns zeroes because modes are set by
 * toggling AUX channel ranges, not by sending a mode number.
 */
class BetaflightHandler implements FirmwareHandler {
  readonly firmwareType: FirmwareType = 'betaflight'
  readonly vehicleClass: VehicleClass = 'copter'

  /**
   * Betaflight does not use MAVLink-style mode numbers.
   * Mode switching is done via AUX channels, not commands.
   */
  encodeFlightMode(_mode: UnifiedFlightMode): { baseMode: number; customMode: number } {
    return { baseMode: 0, customMode: 0 }
  }

  /**
   * Simplified mode decoding. Full mode decoding from MSP box flags
   * happens in the MSPAdapter's heartbeat handler.
   */
  decodeFlightMode(_customMode: number): UnifiedFlightMode {
    return 'UNKNOWN'
  }

  /** Betaflight modes available via AUX channel configuration. */
  getAvailableModes(): UnifiedFlightMode[] {
    return ['ACRO', 'STABILIZE', 'ALT_HOLD', 'RTL']
  }

  getDefaultMode(): UnifiedFlightMode {
    return 'ACRO'
  }

  getCapabilities(): ProtocolCapabilities {
    return BETAFLIGHT_CAPABILITIES
  }

  getFirmwareVersion(_params?: Map<string, number>): string {
    return 'Betaflight'
  }

  /** Betaflight uses its own parameter names — pass through as-is. */
  mapParameterName(canonical: string): string {
    return canonical
  }

  reverseMapParameterName(firmwareName: string): string {
    return firmwareName
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const betaflightHandler: FirmwareHandler = new BetaflightHandler()
