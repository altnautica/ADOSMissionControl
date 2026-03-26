/**
 * MSP decoders — Status, identity, modes, and feature flags.
 *
 * @module protocol/msp/msp-decoders-status
 */

import { readU8, readU16, readU32, readString } from './msp-decode-utils';

// ── Types ────────────────────────────────────────────────────

export interface MspApiVersion {
  mspProtocolVersion: number;
  apiVersionMajor: number;
  apiVersionMinor: number;
}

export interface MspFcVariant {
  variant: string;
}

export interface MspFcVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface MspBoardInfo {
  boardId: string;
  hwRevision: number;
  boardType: number;
}

export interface MspStatusEx {
  cycleTime: number;
  i2cErrors: number;
  sensors: number;
  modeFlags: number;
  currentProfile: number;
  cpuLoad: number;
  profileCount: number;
  rateProfile: number;
  armDisableFlags: number;
  configStateFlags: number;
}

export interface MspBoxNames {
  names: string[];
}

export interface MspBoxIds {
  ids: number[];
}

export interface MspModeRange {
  boxId: number;
  auxChannel: number;
  rangeStart: number;
  rangeEnd: number;
}

export interface MspAdjustmentRange {
  slotIndex: number;
  auxChannelIndex: number;
  rangeStart: number;
  rangeEnd: number;
  adjustmentFunction: number;
  auxSwitchChannelIndex: number;
}

export interface MspFeatureConfig {
  featureMask: number;
}

export interface MspArmingConfig {
  autoDisarmDelay: number;
  smallAngle: number;
}

export interface MspBeeperConfig {
  disabledMask: number;
  dshotBeaconTone: number;
  dshotBeaconConditionsMask: number;
}

// ── Decoders ─────────────────────────────────────────────────

/**
 * MSP_API_VERSION (1)
 * Bytes: U8 protocol, U8 major, U8 minor
 */
export function decodeMspApiVersion(dv: DataView): MspApiVersion {
  return {
    mspProtocolVersion: readU8(dv, 0),
    apiVersionMajor: readU8(dv, 1),
    apiVersionMinor: readU8(dv, 2),
  };
}

/**
 * MSP_FC_VARIANT (2)
 * 4 ASCII bytes: "BTFL" or "INAV"
 */
export function decodeMspFcVariant(dv: DataView): MspFcVariant {
  return {
    variant: readString(dv, 0, 4),
  };
}

/**
 * MSP_FC_VERSION (3)
 * 3 U8s: major, minor, patch
 */
export function decodeMspFcVersion(dv: DataView): MspFcVersion {
  return {
    major: readU8(dv, 0),
    minor: readU8(dv, 1),
    patch: readU8(dv, 2),
  };
}

/**
 * MSP_BOARD_INFO (4)
 * 4 ASCII + U16 hwRevision + U8 boardType (+ more, but we stop at the core fields)
 */
export function decodeMspBoardInfo(dv: DataView): MspBoardInfo {
  return {
    boardId: readString(dv, 0, 4),
    hwRevision: readU16(dv, 4),
    boardType: readU8(dv, 6),
  };
}

/**
 * MSP_STATUS_EX (150)
 *
 * Layout (from MSPHelper.js):
 *   U16 cycleTime
 *   U16 i2cErrors
 *   U16 sensors
 *   U32 modeFlags
 *   U8  currentProfile
 *   U16 cpuLoad
 *   U8  profileCount
 *   U8  rateProfile
 *   U8  byteCount (flight mode flags — variable, skip)
 *   ... byteCount bytes (skip)
 *   U8  armDisableCount
 *   U32 armDisableFlags
 *   U8  configStateFlags
 *
 * We parse up to configStateFlags. The variable-length flight mode flags
 * section is skipped by computing the offset.
 */
export function decodeMspStatusEx(dv: DataView): MspStatusEx {
  const cycleTime = readU16(dv, 0);
  const i2cErrors = readU16(dv, 2);
  const sensors = readU16(dv, 4);
  const modeFlags = readU32(dv, 6);
  const currentProfile = readU8(dv, 10);
  const cpuLoad = readU16(dv, 11);
  const profileCount = readU8(dv, 13);
  const rateProfile = readU8(dv, 14);

  // Variable-length flight mode flags
  const byteCount = readU8(dv, 15);
  const afterFlags = 16 + byteCount;

  // armDisableCount at afterFlags, then U32 armDisableFlags, then U8 configStateFlags
  const armDisableFlags = readU32(dv, afterFlags + 1);
  const configStateFlags = readU8(dv, afterFlags + 5);

  return {
    cycleTime,
    i2cErrors,
    sensors,
    modeFlags,
    currentProfile,
    cpuLoad,
    profileCount,
    rateProfile,
    armDisableFlags,
    configStateFlags,
  };
}

/**
 * MSP_BOXNAMES (116)
 * Semicolon-delimited ASCII string of mode names
 */
export function decodeMspBoxNames(dv: DataView): MspBoxNames {
  let raw = '';
  for (let i = 0; i < dv.byteLength; i++) {
    raw += String.fromCharCode(readU8(dv, i));
  }
  const names = raw.split(';').filter((n) => n.length > 0);
  return { names };
}

/**
 * MSP_BOXIDS (119)
 * Each byte is a U8 box ID
 */
export function decodeMspBoxIds(dv: DataView): MspBoxIds {
  const ids: number[] = [];
  for (let i = 0; i < dv.byteLength; i++) {
    ids.push(readU8(dv, i));
  }
  return { ids };
}

/**
 * MSP_MODE_RANGES (34)
 * 4 bytes per range: U8 boxId, U8 auxChannel, U8 rangeStartStep, U8 rangeEndStep
 * PWM = step * 25 + 900
 */
export function decodeMspModeRanges(dv: DataView): MspModeRange[] {
  const count = dv.byteLength / 4;
  const ranges: MspModeRange[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * 4;
    ranges.push({
      boxId: readU8(dv, off),
      auxChannel: readU8(dv, off + 1),
      rangeStart: 900 + readU8(dv, off + 2) * 25,
      rangeEnd: 900 + readU8(dv, off + 3) * 25,
    });
  }
  return ranges;
}

/**
 * MSP_ADJUSTMENT_RANGES (52)
 * 6 bytes per range: U8 slotIndex, U8 auxChannelIndex, U8 startStep, U8 endStep,
 *                    U8 adjustmentFunction, U8 auxSwitchChannelIndex
 * PWM = step * 25 + 900
 */
export function decodeMspAdjustmentRanges(dv: DataView): MspAdjustmentRange[] {
  const count = dv.byteLength / 6;
  const ranges: MspAdjustmentRange[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * 6;
    ranges.push({
      slotIndex: readU8(dv, off),
      auxChannelIndex: readU8(dv, off + 1),
      rangeStart: 900 + readU8(dv, off + 2) * 25,
      rangeEnd: 900 + readU8(dv, off + 3) * 25,
      adjustmentFunction: readU8(dv, off + 4),
      auxSwitchChannelIndex: readU8(dv, off + 5),
    });
  }
  return ranges;
}

/**
 * MSP_FEATURE_CONFIG (36)
 * U32 featureMask
 */
export function decodeMspFeatureConfig(dv: DataView): MspFeatureConfig {
  return {
    featureMask: readU32(dv, 0),
  };
}

/**
 * MSP_ARMING_CONFIG (61)
 *   U8 autoDisarmDelay
 *   U8 (was kill switch, skip)
 *   U8 smallAngle
 */
export function decodeMspArmingConfig(dv: DataView): MspArmingConfig {
  return {
    autoDisarmDelay: readU8(dv, 0),
    // offset 1 = deprecated kill_switch, skip
    smallAngle: readU8(dv, 2),
  };
}

/**
 * MSP_BEEPER_CONFIG (184)
 *   U32 disabledMask
 *   U8  dshotBeaconTone
 *   U32 dshotBeaconConditionsMask
 */
export function decodeMspBeeperConfig(dv: DataView): MspBeeperConfig {
  return {
    disabledMask: readU32(dv, 0),
    dshotBeaconTone: readU8(dv, 4),
    dshotBeaconConditionsMask: readU32(dv, 5),
  };
}
