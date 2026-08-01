/**
 * iNav navigation decoders: waypoints, extended status, safehome, legacy
 * nav config, MISC/MISC2 telemetry, and fixed-wing landing approach.
 *
 * Includes two encoders colocated with their paired decoders for symmetry:
 * `encodeMspSetWp` and `encodeMspINavSetSafehome`.
 *
 * @module protocol/msp/decoders/inav/nav
 */

import { readU8, readU16, readU32, readS16, readS32 } from "./helpers";
import { writeU8, writeI32, writeBits16 } from "../../../encoders/bounds";
import type {
  INavWaypoint,
  INavStatus,
  INavMisc2,
  INavSafehome,
  INavNavConfig,
  INavMisc,
  INavFwApproach,
} from "./types";

// ── Waypoint decoder/encoder ─────────────────────────────────

/**
 * MSP_WP (118)
 *
 * U8  number
 * U8  action (1-8, see INAV_WP_ACTION)
 * S32 lat (degrees x 1e7)
 * S32 lon (degrees x 1e7)
 * S32 altitude (cm)
 * S16 p1 (action-specific, signed — e.g. SET_HEAD -1 = no fixed heading)
 * S16 p2 (action-specific, signed — e.g. LAND elevation below home is negative)
 * U16 p3 (action-specific bitfield — e.g. LAND altitude-datum + USER bits)
 * U8  flag (0 = not last, 0xA5 = last waypoint)
 */
export function decodeMspWp(dv: DataView): INavWaypoint {
  return {
    number: readU8(dv, 0),
    action: readU8(dv, 1),
    lat: readS32(dv, 2) / 1e7,
    lon: readS32(dv, 6) / 1e7,
    altitude: readS32(dv, 10),
    p1: readS16(dv, 14),
    p2: readS16(dv, 16),
    p3: readU16(dv, 18),
    flag: readU8(dv, 20),
  };
}

/**
 * Encode MSP_SET_WP (209) payload.
 * Same layout as the MSP_WP read response.
 */
export function encodeMspSetWp(wp: INavWaypoint): Uint8Array {
  const buf = new Uint8Array(21);
  const dv = new DataView(buf.buffer);

  // Each field is range-checked rather than narrowed: waypoint 256 narrowed to
  // 0 addresses the first mission item and overwrites it, which reads on the
  // aircraft as a mission that uploaded cleanly.
  writeU8(dv, 0, wp.number, 'waypoint number');
  writeU8(dv, 1, wp.action, 'waypoint action');
  writeI32(dv, 2, Math.round(wp.lat * 1e7), 'waypoint latitude');
  writeI32(dv, 6, Math.round(wp.lon * 1e7), 'waypoint longitude');
  writeI32(dv, 10, wp.altitude, 'waypoint altitude');
  writeBits16(dv, 14, wp.p1, 'waypoint p1');
  writeBits16(dv, 16, wp.p2, 'waypoint p2');
  writeBits16(dv, 18, wp.p3, 'waypoint p3');
  writeU8(dv, 20, wp.flag, 'waypoint flag');

  return buf;
}

// ── iNav extended status decoder ─────────────────────────────

/**
 * MSP2_INAV_STATUS (0x2000)
 *
 * U16 cycleTime
 * U16 i2cErrors
 * U16 sensors
 * U16 (reserved, skip 2 bytes)
 * U32 modeFlags
 * U8  currentProfile
 * U16 cpuLoad
 * U8  (profile count, skip)
 * U8  (rate profile, skip)
 * U32 armingFlags
 * U8  navState
 * U8  navAction
 *
 * Layout handles the common fields present in iNav 6.x+ (API 2.5+).
 */
export function decodeMspINavStatus(dv: DataView): INavStatus {
  const cycleTime = readU16(dv, 0);
  const i2cErrors = readU16(dv, 2);
  const sensors = readU16(dv, 4);
  // offset 6-7: reserved
  const modeFlags = readU32(dv, 8);
  const currentProfile = readU8(dv, 12);
  const cpuLoad = readU16(dv, 13);
  // offset 15: profile count
  // offset 16: rate profile
  const armingFlags = readU32(dv, 17);

  const navState = dv.byteLength > 21 ? readU8(dv, 21) : 0;
  const navAction = dv.byteLength > 22 ? readU8(dv, 22) : 0;

  return {
    cycleTime,
    i2cErrors,
    sensors,
    modeFlags,
    currentProfile,
    cpuLoad,
    armingFlags,
    navState,
    navAction,
  };
}

// ── iNav MISC2 decoder ───────────────────────────────────────

/**
 * MSP2_INAV_MISC2 (0x203A)
 *
 * U32 onTime (seconds)
 * U32 flyTime (seconds)
 * U32 lastArmTime (seconds)
 * U32 totalArmTime (seconds)
 * U8  flags
 */
export function decodeMspINavMisc2(dv: DataView): INavMisc2 {
  return {
    onTime: readU32(dv, 0),
    flyTime: readU32(dv, 4),
    lastArmTime: readU32(dv, 8),
    totalArmTime: readU32(dv, 12),
    flags: dv.byteLength > 16 ? readU8(dv, 16) : 0,
  };
}

// ── iNav safehome decoder/encoder ────────────────────────────

/**
 * MSP2_INAV_SAFEHOME (0x2038)
 *
 * U8  index
 * U8  enabled (bool)
 * S32 lat (degrees x 1e7)
 * S32 lon (degrees x 1e7)
 */
export function decodeMspINavSafehome(dv: DataView): INavSafehome {
  return {
    index: readU8(dv, 0),
    enabled: readU8(dv, 1) !== 0,
    lat: readS32(dv, 2) / 1e7,
    lon: readS32(dv, 6) / 1e7,
  };
}

/**
 * Encode MSP2_INAV_SET_SAFEHOME (0x2039) payload.
 */
export function encodeMspINavSetSafehome(sh: INavSafehome): Uint8Array {
  const buf = new Uint8Array(10);
  const dv = new DataView(buf.buffer);

  dv.setUint8(0, sh.index);
  dv.setUint8(1, sh.enabled ? 1 : 0);
  dv.setInt32(2, Math.round(sh.lat * 1e7), true);
  dv.setInt32(6, Math.round(sh.lon * 1e7), true);

  return buf;
}

// ── iNav NAV config decoder (legacy, 0x2100) ─────────────────

/**
 * Decodes the legacy nav-config response at ID 0x2100.
 *
 * NOTE: ID 0x2100 collides with MSP2_INAV_CUSTOM_OSD_ELEMENTS in
 * newer iNav builds. This decoder is retained for pre-7.x compatibility
 * and should not be used on builds that report Custom OSD Elements at 0x2100.
 *
 * Payload layout:
 * U32 maxNavAltitude (cm)
 * U16 maxNavSpeed (cm/s)
 * U16 maxClimbRate (cm/s)
 * U16 maxManualClimbRate (cm/s)
 * U16 maxManualSpeed (cm/s)
 * U16 landSlowdownMinAlt (cm)
 * U16 landSlowdownMaxAlt (cm)
 * U16 navEmergencyLandingSpeed (cm/s)
 * U16 navMinRthDistance (cm)
 * U8  navOverclimbAngle (degrees)
 * U8  useMidThrottleForAlthold (bool)
 * U8  navExtraArming
 */
export function decodeMspINavNavConfigLegacy(dv: DataView): INavNavConfig {
  return {
    maxNavAltitude: readU32(dv, 0),
    maxNavSpeed: readU16(dv, 4),
    maxClimbRate: readU16(dv, 6),
    maxManualClimbRate: readU16(dv, 8),
    maxManualSpeed: readU16(dv, 10),
    landSlowdownMinAlt: readU16(dv, 12),
    landSlowdownMaxAlt: readU16(dv, 14),
    navEmergencyLandingSpeed: readU16(dv, 16),
    navMinRthDistance: readU16(dv, 18),
    navOverclimbAngle: readU8(dv, 20),
    useMidThrottleForAlthold: readU8(dv, 21) !== 0,
    navExtraArming: dv.byteLength > 22 ? readU8(dv, 22) : 0,
  };
}

/**
 * Alias for the legacy nav config decoder.
 * @deprecated Use decodeMspINavNavConfigLegacy. This name existed before the ID collision was identified.
 */
export const decodeMspNavConfig = decodeMspINavNavConfigLegacy;

// ── iNav MISC decoder ────────────────────────────────────────

/**
 * MSP2_INAV_MISC (0x2003) - iNav 7 layout.
 *
 * U16 midrc
 * U16 minthrottle
 * U16 maxthrottle
 * U16 mincommand
 * U16 failsafeThrottle
 * U8  gpsProvider
 * U8  gpsBaudrateIdx
 * U8  gpsUbxSbas
 * U8  multiwiiCurrentOutput
 * U8  rssiChannel
 * U8  placeholder
 * U16 magDeclination (tenths of degrees)
 * U8  voltageScale
 * U8  cellMin (tenths of volt)
 * U8  cellMax (tenths of volt)
 * U8  cellWarning (tenths of volt)
 */
export function decodeMspINavMisc(dv: DataView): INavMisc {
  return {
    midrc: readU16(dv, 0),
    minthrottle: readU16(dv, 2),
    maxthrottle: readU16(dv, 4),
    mincommand: readU16(dv, 6),
    failsafeThrottle: readU16(dv, 8),
    gpsProvider: dv.byteLength > 10 ? readU8(dv, 10) : 0,
    gpsBaudrateIdx: dv.byteLength > 11 ? readU8(dv, 11) : 0,
    gpsUbxSbas: dv.byteLength > 12 ? readU8(dv, 12) : 0,
    multiwiiCurrentOutput: dv.byteLength > 13 ? readU8(dv, 13) : 0,
    rssiChannel: dv.byteLength > 14 ? readU8(dv, 14) : 0,
    placeholder: dv.byteLength > 15 ? readU8(dv, 15) : 0,
    magDeclination: dv.byteLength > 17 ? readU16(dv, 16) : 0,
    voltageScale: dv.byteLength > 18 ? readU8(dv, 18) : 0,
    cellMin: dv.byteLength > 19 ? readU8(dv, 19) : 0,
    cellMax: dv.byteLength > 20 ? readU8(dv, 20) : 0,
    cellWarning: dv.byteLength > 21 ? readU8(dv, 21) : 0,
  };
}

// ── iNav FW APPROACH decoder ──────────────────────────────────

/**
 * MSP2_INAV_FW_APPROACH (0x204a)
 *
 * Repeated per approach:
 *   U8  number
 *   S32 approachAlt (cm)
 *   S32 landAlt (cm)
 *   U8  approachDirection
 *   S16 landHeading1 (degrees)
 *   S16 landHeading2 (degrees)
 *   U8  isSeaLevelRef (bool)
 */
export function decodeMspINavFwApproach(dv: DataView): INavFwApproach[] {
  const result: INavFwApproach[] = [];
  let offset = 0;
  while (offset + 14 <= dv.byteLength) {
    result.push({
      number: readU8(dv, offset),
      approachAlt: readS32(dv, offset + 1),
      landAlt: readS32(dv, offset + 5),
      approachDirection: readU8(dv, offset + 9),
      landHeading1: readS16(dv, offset + 10),
      landHeading2: readS16(dv, offset + 12),
      isSeaLevelRef: dv.byteLength > offset + 14 ? readU8(dv, offset + 14) !== 0 : false,
    });
    offset += 15;
  }
  return result;
}
