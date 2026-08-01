/**
 * iNav firmware handler for Altnautica Command GCS.
 *
 * iNav uses MSP protocol (like Betaflight) but adds navigation modes
 * (NAV POSHOLD, NAV RTH, NAV WP, NAV CRUISE, NAV LAUNCH) on top of
 * the standard Betaflight box-mode system. Extended capabilities include
 * safehomes, geozones, logic conditions, programming PIDs, and more.
 *
 * Mode encoding uses iNav box IDs. iNav activates modes via AUX channel
 * ranges (same mechanism as Betaflight), but the box IDs differ for
 * navigation modes.
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
export const INAV_BOX_TO_MODE: Record<number, UnifiedFlightMode> = {
  // 0: ARM (not a flight mode)
  1: 'STABILIZE',     // BOXANGLE
  2: 'STABILIZE',     // BOXHORIZON (self-leveling, treat as stabilize)
  // BOXHEADFREE (id 5) is a heading-free behavior, not ACRO and not MANUAL;
  // it has no unified equivalent, so it is intentionally not mapped and
  // decodes to UNKNOWN rather than a wrong active mode.
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
export const MODE_TO_INAV_BOX: Partial<Record<UnifiedFlightMode, number>> = {
  STABILIZE: 1,
  ALT_HOLD: 10,   // NAV ALTHOLD preferred over HORIZON
  // MANUAL is intentionally unmapped: id 5 is BOXHEADFREE, not a manual box,
  // and there is no reliable unified-to-box mapping for it here. (iNav mode
  // selection over MSP is driven by AUX-channel ranges, not a direct set.)
  POSHOLD: 11,
  LOITER: 12,
  CRUISE: 28,
  RTL: 45,
  MISSION: 46,
  TAKEOFF: 47,
}

/**
 * The name iNav's own modes tab shows for each box, so a message about a mode
 * that has no switch assigned names it the way the operator will find it.
 */
export const INAV_BOX_LABELS: Record<number, string> = {
  1: 'ANGLE',
  2: 'HORIZON',
  10: 'NAV ALTHOLD',
  11: 'NAV POSHOLD',
  12: 'HEADING HOLD',
  28: 'NAV CRUISE',
  45: 'NAV RTH',
  46: 'NAV WP',
  47: 'NAV LAUNCH',
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/** Minimum iNav major version we officially support. */
export const INAV_MIN_MAJOR = 7;

/**
 * Check whether a firmware version string such as "iNav 7.0.1" or
 * "INAV 7.1.0 (MSP API 2.5)" meets the minimum supported major version.
 */
export function meetsInavMinimum(firmwareVersionString: string): boolean {
  const m = firmwareVersionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  return Number(m[1]) >= INAV_MIN_MAJOR;
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
  // Navigation modes are selected through AUX ranges, and the navigation
  // commands drive them that way.
  supportsAutonomousNav: true,
  supportsGeoFence: true,
  supportsRally: false,
  supportsLogDownload: true,
  supportsOsd: true,
  supportsDisplayPort: true,
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
  // iNav does NOT expose the Betaflight-only Configuration panel — it has its
  // own configuration surfaces (nav config, mixer/battery profiles, etc.).
  supportsBetaflightConfig: false,
  // iNav speaks MSP_MOTOR the same way Betaflight does, so it shares the MSP
  // motors + ESC panel.
  supportsMspMotors: true,
  supportsGpsConfig: true,
  supportsEkfConfig: false,
  supportsStreamRates: false,
  supportsVtolConfig: false,
  supportsTecsConfig: false,
  supportsSubConfig: false,
  supportsPx4Tuning: false,
  supportsRateProfiles: true,
  supportsAdjustments: true,
  supportsMavlinkSigning: false,
  // iNav-specific capabilities
  supportsMultiMission: true,
  supportsSafehome: true,
  supportsGeozone: true,
  supportsLogicConditions: true,
  supportsGlobalVariables: true,
  supportsProgrammingPid: true,
  supportsEzTune: true,
  supportsFwApproach: true,
  supportsCustomOsd: true,
  supportsMixerProfile: true,
  supportsBatteryProfile: true,
  supportsTempSensors: true,
  supportsServoMixer: true,
  supportsOutputMappingExt: true,
  supportsRateDynamics: true,
  supportsMcBraking: true,
  supportsSettings: true,
  supportsCliSettings: false,
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
