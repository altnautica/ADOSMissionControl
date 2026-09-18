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
 * iNav box PERMANENT IDs mapped to unified flight modes.
 *
 * These are iNav's permanent box IDs (`boxId` in `inav/src/main/fc/fc_msp_box.c`
 * `activeBoxIds` / `boxes[]`), which is what both `MSP_BOXIDS` and
 * `MSP_MODE_RANGES` carry on the wire. They are NOT the enum ordinals from
 * `rc_modes.h`.
 *
 * The table used to hold a third set of numbers that matched neither, and it
 * was wrong in both directions:
 *
 *  - Command path: `mspActivateNavMode` drives the looked-up box's AUX range,
 *    so "Return to home" engaged box 45 (NAV COURSE HOLD — hold heading and
 *    fly AWAY), "Takeoff" engaged 47 (USER1), "Resume mission" engaged 46
 *    (MC BRAKING), and "Altitude hold" engaged 10 (NAV RTH).
 *  - Decode path: an aircraft flying NAV RTH was reported as ALT_HOLD, which
 *    is in `STICK_AUTHORITY_MODES`, so the 50 Hz gamepad override was
 *    permitted while the autopilot flew an autonomous return.
 *
 * A box with no honest unified equivalent is deliberately absent and decodes
 * to UNKNOWN rather than to a neighbouring mode:
 *  - 5 HEADING HOLD holds heading, NOT position — mapping it to LOITER would
 *    claim a position hold the aircraft is not doing.
 *  - 45 NAV COURSE HOLD holds a ground course without altitude hold, so it is
 *    not CRUISE (53, course + altitude).
 *  - 46 MC BRAKING and 47 USER1 are not flight modes at all.
 */
export const INAV_BOX_TO_MODE: Record<number, UnifiedFlightMode> = {
  // 0: ARM (not a flight mode)
  1: 'STABILIZE',     // ANGLE
  2: 'STABILIZE',     // HORIZON (self-levelling, treat as stabilize)
  3: 'ALT_HOLD',      // NAV ALTHOLD
  10: 'RTL',          // NAV RTH
  11: 'POSHOLD',      // NAV POSHOLD
  12: 'MANUAL',       // MANUAL
  28: 'MISSION',      // NAV WP
  36: 'TAKEOFF',      // NAV LAUNCH
  53: 'CRUISE',       // NAV CRUISE (course + altitude)
}

/**
 * Reverse map: UnifiedFlightMode to iNav box permanent ID.
 * For modes that map to multiple box IDs, the primary (most common) is used.
 */
export const MODE_TO_INAV_BOX: Partial<Record<UnifiedFlightMode, number>> = {
  STABILIZE: 1,
  ALT_HOLD: 3,    // NAV ALTHOLD preferred over HORIZON
  MANUAL: 12,
  POSHOLD: 11,
  CRUISE: 53,
  RTL: 10,
  MISSION: 28,
  TAKEOFF: 36,
}

/**
 * The name iNav's own modes tab shows for each box, so a message about a mode
 * that has no switch assigned names it the way the operator will find it.
 */
export const INAV_BOX_LABELS: Record<number, string> = {
  1: 'ANGLE',
  2: 'HORIZON',
  3: 'NAV ALTHOLD',
  5: 'HEADING HOLD',
  10: 'NAV RTH',
  11: 'NAV POSHOLD',
  12: 'MANUAL',
  28: 'NAV WP',
  36: 'NAV LAUNCH',
  45: 'NAV COURSE HOLD',
  46: 'MC BRAKING',
  47: 'USER1',
  53: 'NAV CRUISE',
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
