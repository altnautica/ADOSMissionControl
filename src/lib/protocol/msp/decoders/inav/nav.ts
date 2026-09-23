/**
 * iNav navigation decoders: waypoints, extended status, safehome,
 * MISC/MISC2 telemetry, and fixed-wing landing approach.
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
 * Layout from iNav `fc_msp.c` `mspFcProcessOutCommand`:
 *
 * ```
 * U16 cycleTime                     @0
 * U16 i2cErrorCounter               @2
 * U16 sensorStatus                  @4
 * U16 averageSystemLoadPercent      @6
 * U8  batteryProfile<<4 | profile   @8
 * U32 armingFlags                   @9
 * U32[] boxModeFlags                @13 (whole u32 words, count by build)
 * U8  mixerProfile                  last byte (firmware with mixer profiles)
 * ```
 *
 * There is NO nav state in this message — `MSP_NAV_STATUS` (121) carries it.
 * This decoder previously read a reserved gap at 6, `modeFlags` at 8,
 * `armingFlags` at 17 and invented `navState`/`navAction` at 21/22, so every
 * field after byte 6 was wrong.
 */
export function decodeMspINavStatus(dv: DataView): INavStatus {
  return {
    cycleTime: readU16(dv, 0),
    i2cErrors: readU16(dv, 2),
    sensors: readU16(dv, 4),
    averageLoadPercent: readU16(dv, 6),
    /** Low nibble is the config profile, high nibble the battery profile. */
    profiles: readU8(dv, 8),
    armingFlags: readU32(dv, 9),
  };
}

/**
 * The active mixer profile from MSP2_INAV_STATUS, 0-based. It is the byte
 * after the box-mode bitmask, whose length is a whole number of u32 words
 * that varies with the build's box count, so the byte is found from the
 * payload length. Null when the firmware sends no mixer-profile byte.
 */
export function decodeMspINavStatusMixerProfile(dv: DataView): number | null {
  const afterArming = dv.byteLength - 13;
  if (afterArming < 1 || afterArming % 4 !== 1) return null;
  return readU8(dv, dv.byteLength - 1);
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
 * MSP2_INAV_FW_APPROACH (0x204a) reply for one requested slot, 15 bytes:
 *
 *   U8  number
 *   S32 approachAlt (cm)
 *   S32 landAlt (cm)
 *   U8  approachDirection (0 = left, 1 = right)
 *   S16 landHeading1 (degrees)
 *   S16 landHeading2 (degrees)
 *   U8  isSeaLevelRef (bool)
 */
export function decodeMspINavFwApproach(dv: DataView): INavFwApproach {
  if (dv.byteLength < 15) {
    throw new RangeError(`FW approach reply is ${dv.byteLength} bytes, expected 15`);
  }
  return {
    number: readU8(dv, 0),
    approachAlt: readS32(dv, 1),
    landAlt: readS32(dv, 5),
    approachDirection: readU8(dv, 9),
    landHeading1: readS16(dv, 10),
    landHeading2: readS16(dv, 12),
    isSeaLevelRef: readU8(dv, 14) !== 0,
  };
}
