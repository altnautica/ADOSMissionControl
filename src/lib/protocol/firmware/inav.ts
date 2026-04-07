/**
 * iNav firmware handler for Altnautica Command GCS.
 *
 * iNav uses MSP protocol (like Betaflight) but adds navigation modes
 * (NAV POSHOLD, NAV RTH, NAV WP, NAV CRUISE, NAV LAUNCH) on top of
 * the standard Betaflight box-mode system.
 *
 * Mode encoding uses iNav box IDs. iNav activates modes via AUX channel
 * ranges (same mechanism as Betaflight), but the box IDs differ for
 * navigation modes.
 *
 * Reference: inav-configurator/src/js/fc.js, inav/src/main/fc/rc_modes.h
 *
 * @module firmware/inav
 */

import type {
  FirmwareType,
  FirmwareHandler,
  UnifiedFlightMode,
  VehicleClass,
  ProtocolCapabilities,
} from '../types'

// ---------------------------------------------------------------------------
// iNav box ID to UnifiedFlightMode mapping
// ---------------------------------------------------------------------------

/**
 * iNav box IDs mapped to unified flight modes.
 *
 * Box IDs from inav/src/main/fc/rc_modes.h (BOXARM=0, BOXANGLE=1, etc.)
 * Only modes that map to a unified mode are included; hardware-toggle
 * boxes (BEEPER, LEDLOW, etc.) are excluded.
 */
const INAV_BOX_TO_MODE: Record<number, UnifiedFlightMode> = {
  // 0: ARM (not a flight mode)
  1: 'STABILIZE',     // BOXANGLE
  2: 'ALT_HOLD',      // BOXHORIZON
  5: 'MANUAL',        // BOXHEADFREE
  10: 'ALT_HOLD',     // BOXNAVALTHOLD
  11: 'POSHOLD',      // BOXNAVPOSHOLD
  12: 'LOITER',       // BOXHEADINGHOLD (heading hold while loitering)
  28: 'CRUISE',       // BOXNAVCRUISE
  // 29: NAV COURSE HOLD (no unified equivalent, maps to CRUISE)
  45: 'RTL',          // BOXNAVRTH
  46: 'MISSION',      // BOXNAVWP
  47: 'TAKEOFF',      // BOXNAVLAUNCH
}

/**
 * Reverse map: UnifiedFlightMode to iNav box ID.
 * For modes that map to multiple box IDs, the primary (most common) is used.
 */
const MODE_TO_INAV_BOX: Partial<Record<UnifiedFlightMode, number>> = {
  STABILIZE: 1,
  ALT_HOLD: 10,   // NAV ALTHOLD preferred over HORIZON
  MANUAL: 5,
  POSHOLD: 11,
  LOITER: 12,
  CRUISE: 28,
  RTL: 45,
  MISSION: 46,
  TAKEOFF: 47,
}

// ---------------------------------------------------------------------------
// iNav capabilities
// ---------------------------------------------------------------------------

const INAV_CAPABILITIES: ProtocolCapabilities = {
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
  supportsRangefinder: true,
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
  parameterCount: 400,
}

// ---------------------------------------------------------------------------
// INavHandler
// ---------------------------------------------------------------------------

/**
 * Firmware handler for iNav.
 *
 * Extends the Betaflight box-mode system with navigation modes (NAV POSHOLD,
 * NAV RTH, NAV WP, NAV CRUISE, NAV LAUNCH). Mode encoding maps iNav box IDs
 * to unified flight modes.
 */
class INavHandler implements FirmwareHandler {
  readonly firmwareType: FirmwareType = 'inav'
  readonly vehicleClass: VehicleClass = 'copter'

  /**
   * Encode a unified flight mode to iNav box ID.
   *
   * Returns the box ID as customMode. baseMode is unused in MSP
   * (modes are activated via AUX channel ranges, not direct set).
   * The customMode can be used to identify which box to toggle.
   */
  encodeFlightMode(mode: UnifiedFlightMode): { baseMode: number; customMode: number } {
    const boxId = MODE_TO_INAV_BOX[mode]
    if (boxId !== undefined) {
      return { baseMode: 0, customMode: boxId }
    }
    // ACRO = no box active (default when no mode boxes are enabled)
    if (mode === 'ACRO') {
      return { baseMode: 0, customMode: -1 }
    }
    return { baseMode: 0, customMode: 0 }
  }

  /**
   * Decode an iNav box ID to a unified flight mode.
   *
   * In MSP, the "current mode" is derived from the modeFlags bitmask
   * in MSP_STATUS_EX, not from a single customMode value. This method
   * decodes a single box ID (useful when iterating active flags).
   */
  decodeFlightMode(customMode: number): UnifiedFlightMode {
    return INAV_BOX_TO_MODE[customMode] ?? 'UNKNOWN'
  }

  /**
   * All flight modes available in iNav.
   *
   * Includes both standard modes (shared with Betaflight) and
   * iNav-specific navigation modes.
   */
  getAvailableModes(): UnifiedFlightMode[] {
    return [
      'ACRO',
      'STABILIZE',
      'ALT_HOLD',
      'MANUAL',
      'POSHOLD',
      'LOITER',
      'CRUISE',
      'RTL',
      'MISSION',
      'TAKEOFF',
      'LAND',
    ]
  }

  getDefaultMode(): UnifiedFlightMode {
    return 'ACRO'
  }

  getCapabilities(): ProtocolCapabilities {
    return INAV_CAPABILITIES
  }

  getFirmwareVersion(_params?: Map<string, number>): string {
    return 'iNav'
  }

  /** iNav uses its own parameter names -- pass through as-is. */
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

export const inavHandler: FirmwareHandler = new INavHandler()
