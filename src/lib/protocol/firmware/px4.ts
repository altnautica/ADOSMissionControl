/**
 * PX4 firmware handler for Altnautica Command GCS.
 *
 * PX4 uses a different custom_mode encoding than ArduPilot:
 * main_mode in bits 16-23, sub_mode in bits 0-15.
 *
 * @module firmware/px4
 */

import type {
  FirmwareType,
  FirmwareHandler,
  UnifiedFlightMode,
  VehicleClass,
  ProtocolCapabilities,
} from '../types'
import { PX4_PARAM_MAP, PX4_REVERSE_MAP } from './px4-params'
import { PX4_CAPABILITIES, px4VehicleClassFromMavType, PX4_UNSUPPORTED_MESSAGE } from './px4-capabilities'

// Re-export for consumers that import from this module
export { PX4_PARAM_MAP, PX4_REVERSE_MAP } from './px4-params'
export { PX4_CAPABILITIES, px4VehicleClassFromMavType, PX4_UNSUPPORTED_MESSAGE } from './px4-capabilities'

// ---------------------------------------------------------------------------
// PX4 mode constants
// ---------------------------------------------------------------------------

// Note: TERMINATION in PX4 is a MAV_CMD (MAV_CMD_DO_FLIGHTTERMINATION),
// not a flight mode. It cannot be set via SET_MODE.
// ALTITUDE_CRUISE does not exist in PX4. The closest equivalent
// is ALTCTL (Altitude Control) + manual throttle.

/** PX4 main mode IDs (bits 16-23 of custom_mode). */
const PX4_MAIN_MODE = {
  MANUAL: 1,
  ALTCTL: 2,
  POSCTL: 3,
  AUTO: 4,
  ACRO: 5,
  OFFBOARD: 6,
  STABILIZED: 7,
  RATTITUDE: 8,
} as const

/**
 * PX4 AUTO sub-mode IDs (sub_mode byte when main_mode is AUTO). Sub 7 is
 * reserved (formerly RTGS) and must never be commanded.
 */
const PX4_AUTO_SUB = {
  READY: 1,
  TAKEOFF: 2,
  LOITER: 3,
  MISSION: 4,
  RTL: 5,
  LAND: 6,
  FOLLOW_TARGET: 8,
  PRECLAND: 9,
  VTOL_TAKEOFF: 10,
} as const

/** PX4 POSCTL sub-mode IDs (sub_mode byte when main_mode is POSCTL). */
const PX4_POSCTL_SUB = {
  POSCTL: 0,
  ORBIT: 1,
} as const

// ---------------------------------------------------------------------------
// Mode mapping table: [main, sub, unified]
// ---------------------------------------------------------------------------

const PX4_MODE_TABLE: ReadonlyArray<[number, number, UnifiedFlightMode]> = [
  [PX4_MAIN_MODE.MANUAL, 0, 'MANUAL'],
  [PX4_MAIN_MODE.ALTCTL, 0, 'ALT_HOLD'],
  [PX4_MAIN_MODE.POSCTL, PX4_POSCTL_SUB.POSCTL, 'POSHOLD'],
  [PX4_MAIN_MODE.POSCTL, PX4_POSCTL_SUB.ORBIT, 'ORBIT'],
  [PX4_MAIN_MODE.STABILIZED, 0, 'STABILIZE'],
  [PX4_MAIN_MODE.ACRO, 0, 'ACRO'],
  [PX4_MAIN_MODE.OFFBOARD, 0, 'OFFBOARD'],
  [PX4_MAIN_MODE.RATTITUDE, 0, 'RATTITUDE'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.MISSION, 'AUTO'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.LOITER, 'LOITER'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.RTL, 'RTL'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.LAND, 'LAND'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.TAKEOFF, 'TAKEOFF'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.MISSION, 'MISSION'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.FOLLOW_TARGET, 'FOLLOW_ME'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.READY, 'READY'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.PRECLAND, 'PRECLAND'],
  [PX4_MAIN_MODE.AUTO, PX4_AUTO_SUB.VTOL_TAKEOFF, 'VTOL_TAKEOFF'],
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// PX4 custom_mode is a packed union:
//   bits  0-15 : reserved
//   bits 16-23 : main_mode
//   bits 24-31 : sub_mode
// Unsigned shifts keep the result a proper uint32 (sub_mode can set bit 31).
function encodeCustomMode(main: number, sub: number): number {
  return ((sub << 24) | (main << 16)) >>> 0
}

function decodeCustomMode(customMode: number): { main: number; sub: number } {
  return {
    main: (customMode >>> 16) & 0xff,
    sub: (customMode >>> 24) & 0xff,
  }
}

// ---------------------------------------------------------------------------
// PX4Handler
// ---------------------------------------------------------------------------

/**
 * Firmware handler for PX4 autopilot.
 *
 * Handles PX4's custom_mode encoding where main_mode occupies bits 16-23
 * and sub_mode occupies bits 24-31.
 */
class PX4Handler implements FirmwareHandler {
  readonly firmwareType: FirmwareType = 'px4'
  readonly vehicleClass: VehicleClass

  private modeToEncoding = new Map<UnifiedFlightMode, { main: number; sub: number }>()
  private encodingToMode = new Map<number, UnifiedFlightMode>()

  constructor(vehicleClass: VehicleClass = 'copter') {
    this.vehicleClass = vehicleClass
    for (const [main, sub, mode] of PX4_MODE_TABLE) {
      const key = encodeCustomMode(main, sub)
      // First occurrence wins for decode
      if (!this.encodingToMode.has(key)) {
        this.encodingToMode.set(key, mode)
      }
      // First occurrence wins for encode
      if (!this.modeToEncoding.has(mode)) {
        this.modeToEncoding.set(mode, { main, sub })
      }
    }
  }

  /**
   * Encode a unified flight mode into PX4's base_mode + custom_mode pair.
   *
   * base_mode carries only MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (0x01); the
   * main/sub mode rides in custom_mode, which PX4's commander reads. The
   * mode-change command must not assert the SAFETY_ARMED bit (0x80) or other
   * legacy flags — arming is a separate command.
   */
  encodeFlightMode(mode: UnifiedFlightMode): { baseMode: number; customMode: number } {
    const enc = this.modeToEncoding.get(mode)
    if (!enc) {
      throw new Error(`Unsupported mode for PX4: ${mode}`)
    }
    return { baseMode: 1, customMode: encodeCustomMode(enc.main, enc.sub) }
  }

  /** Decode PX4 custom_mode from HEARTBEAT into a unified flight mode. */
  decodeFlightMode(customMode: number): UnifiedFlightMode {
    // Try exact match first
    const exact = this.encodingToMode.get(customMode)
    if (exact) return exact

    // For non-auto modes, sub might be non-zero — try main only
    const { main } = decodeCustomMode(customMode)
    const mainOnly = this.encodingToMode.get(encodeCustomMode(main, 0))
    return mainOnly ?? 'UNKNOWN'
  }

  /** Return the flight modes PX4 offers for this vehicle class. */
  getAvailableModes(): UnifiedFlightMode[] {
    const modes: UnifiedFlightMode[] = [
      'MANUAL',
      'STABILIZE',
      'ALT_HOLD',
      'POSHOLD',
      'ACRO',
      'OFFBOARD',
      'RATTITUDE',
      'AUTO',
      'MISSION',
      'LOITER',
      'RTL',
      'LAND',
      'TAKEOFF',
      'FOLLOW_ME',
      'ORBIT',
    ]
    if (this.vehicleClass === 'vtol') modes.push('VTOL_TAKEOFF')
    return modes
  }

  /** PX4 defaults to MANUAL. */
  getDefaultMode(): UnifiedFlightMode {
    return 'MANUAL'
  }

  /** PX4 capability set. */
  getCapabilities(): ProtocolCapabilities {
    return PX4_CAPABILITIES
  }

  /** Return a human-readable firmware identifier. */
  getFirmwareVersion(_params?: Map<string, number>): string {
    return 'PX4'
  }

  /** Map canonical ArduPilot parameter names to PX4 equivalents. */
  mapParameterName(canonical: string): string {
    return PX4_PARAM_MAP[canonical] ?? canonical
  }

  reverseMapParameterName(firmwareName: string): string {
    return PX4_REVERSE_MAP[firmwareName] ?? firmwareName
  }

  /** PX4 supported mission commands, filtered by vehicle class. */
  getSupportedMissionCommands(): number[] {
    // Base commands available to all vehicle types. NAV_SPLINE_WAYPOINT (82) is
    // deliberately absent: it is an ArduPilot-only command PX4 does not support
    // (the previous "82 // NAV_DELAY" entry was doubly wrong; NAV_DELAY is 93).
    const base = [
      16,   // NAV_WAYPOINT
      17,   // NAV_LOITER_UNLIM
      19,   // NAV_LOITER_TIME
      20,   // NAV_RETURN_TO_LAUNCH
      21,   // NAV_LAND
      22,   // NAV_TAKEOFF
      31,   // NAV_LOITER_TO_ALT
      93,   // NAV_DELAY
      94,   // NAV_PAYLOAD_PLACE
      177,  // DO_JUMP
      178,  // DO_CHANGE_SPEED
      183,  // DO_SET_SERVO
      200,  // DO_CONTROL_VIDEO
      201,  // DO_SET_ROI
      203,  // DO_DIGICAM_CONTROL
      206,  // DO_SET_CAM_TRIGG_DIST
      2000, // IMAGE_START_CAPTURE
      2001, // IMAGE_STOP_CAPTURE
      2500, // VIDEO_START_CAPTURE
      2501, // VIDEO_STOP_CAPTURE
    ]

    // Plane/VTOL only commands
    if (this.vehicleClass !== 'copter') {
      base.push(
        18,  // NAV_LOITER_TURNS
        84,  // NAV_VTOL_TAKEOFF
        85,  // NAV_VTOL_LAND
        189, // DO_LAND_START
      )
    }

    return base
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/** Create a PX4 handler for a specific vehicle class. */
export function createPX4Handler(vehicleClass: VehicleClass = 'copter'): FirmwareHandler {
  return new PX4Handler(vehicleClass)
}

export const px4Handler: FirmwareHandler = new PX4Handler()

export { PX4Handler }
