/**
 * MSP decoders — PID, rates, filters, serial ports, OSD, VTX, GPS,
 * failsafe, blackbox, LED strip, and advanced configuration.
 *
 * @module protocol/msp/msp-decoders-config
 */

import { readU8, readU16, readU32 } from './msp-decode-utils';

// ── Types ────────────────────────────────────────────────────

export interface MspPidSet {
  p: number;
  i: number;
  d: number;
}

export interface MspPid {
  pids: MspPidSet[];
}

export interface MspRcTuning {
  rcRate: number;
  rcExpo: number;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  throttleMid: number;
  throttleExpo: number;
  rcYawExpo: number;
  rcYawRate: number;
  rcPitchRate: number;
  rcPitchExpo: number;
  throttleLimitType: number;
  throttleLimitPercent: number;
  rollRateLimit: number;
  pitchRateLimit: number;
  yawRateLimit: number;
  ratesType: number;
}

export interface MspFilterConfig {
  gyroLowpassHz: number;
  dtermLowpassHz: number;
  yawLowpassHz: number;
  gyroNotchHz: number;
  gyroNotchCutoff: number;
  dtermNotchHz: number;
  dtermNotchCutoff: number;
  gyroNotch2Hz: number;
  gyroNotch2Cutoff: number;
  dtermLowpassType: number;
  gyroHardwareLpf: number;
  gyroLowpass2Hz: number;
  gyroLowpassType: number;
  gyroLowpass2Type: number;
  dtermLowpass2Hz: number;
  dtermLowpass2Type: number;
  gyroLowpassDynMinHz: number;
  gyroLowpassDynMaxHz: number;
  dtermLowpassDynMinHz: number;
  dtermLowpassDynMaxHz: number;
  dynNotchRange: number;
  dynNotchWidthPercent: number;
  dynNotchQ: number;
  dynNotchMinHz: number;
  gyroRpmNotchHarmonics: number;
  gyroRpmNotchMinHz: number;
  dynNotchMaxHz: number;
  dynLpfCurveExpo: number;
  dynNotchCount: number;
}

export interface MspAdvancedConfig {
  gyroSyncDenom: number;
  pidProcessDenom: number;
  useUnsyncedPwm: number;
  motorPwmProtocol: number;
  motorPwmRate: number;
  digitalIdlePercent: number;
  gyroUse32kHz: number;
  motorPwmInversion: number;
  gyroToUse: number;
  gyroHighFsr: number;
  gyroMovementCalibThreshold: number;
  gyroCalibDuration: number;
  gyroOffsetYaw: number;
  gyroCheckOverflow: number;
  debugMode: number;
  debugModeCount: number;
}

export interface MspFailsafeConfig {
  delay: number;
  offDelay: number;
  throttle: number;
  switchMode: number;
  throttleLowDelay: number;
  procedure: number;
}

export interface MspSerialPort {
  identifier: number;
  functions: number;
  mspBaudRate: number;
  gpsBaudRate: number;
  telemetryBaudRate: number;
  blackboxBaudRate: number;
}

export interface MspSerialConfig {
  ports: MspSerialPort[];
}

export interface MspOsdConfig {
  flags: number;
  videoSystem: number;
  units: number;
  rssiAlarm: number;
  capacityWarning: number;
  items: Array<{ position: number }>;
}

export interface MspLedStripConfig {
  leds: number[];
}

export interface MspVtxConfig {
  type: number;
  band: number;
  channel: number;
  power: number;
  pitMode: boolean;
  frequency: number;
  deviceReady: boolean;
  lowPowerDisarm: number;
  pitModeFrequency: number;
  vtxTableAvailable: boolean;
  vtxTableBands: number;
  vtxTableChannels: number;
  vtxTablePowerLevels: number;
}

export interface MspGpsConfig {
  provider: number;
  sbasMode: number;
  autoConfig: number;
  autoBaud: number;
  homePointOnce: number;
  ubloxUseGalileo: number;
}

export interface MspGpsRescue {
  angle: number;
  initialAltitudeM: number;
  descentDistanceM: number;
  groundSpeed: number;
  throttleMin: number;
  throttleMax: number;
  throttleHover: number;
  sanityChecks: number;
  minSats: number;
  ascendRate: number;
  descendRate: number;
  allowArmingWithoutFix: number;
  altitudeMode: number;
}

export interface MspBlackboxConfig {
  supported: boolean;
  device: number;
  rateNum: number;
  rateDenom: number;
  pDenom: number;
  sampleRate: number;
}

export interface MspDataflashSummary {
  ready: boolean;
  supported: boolean;
  sectors: number;
  totalSize: number;
  usedSize: number;
}

// ── Decoders ─────────────────────────────────────────────────

/**
 * MSP_PID (112)
 * 3 U8s per axis (P, I, D). Typically 10 axes (30 bytes).
 */
export function decodeMspPid(dv: DataView): MspPid {
  const axisCount = dv.byteLength / 3;
  const pids: MspPidSet[] = [];
  for (let i = 0; i < axisCount; i++) {
    const off = i * 3;
    pids.push({
      p: readU8(dv, off),
      i: readU8(dv, off + 1),
      d: readU8(dv, off + 2),
    });
  }
  return { pids };
}

/**
 * MSP_RC_TUNING (111)
 *
 * From MSPHelper.js (API >=1.43, <1.45 for deprecated fields):
 *   U8  rcRate (÷100)
 *   U8  rcExpo (÷100)
 *   U8  rollRate (÷100)
 *   U8  pitchRate (÷100)
 *   U8  yawRate (÷100)
 *   U8  dynamicThrPid (÷100) — deprecated/unused, skip
 *   U8  throttleMid (÷100)
 *   U8  throttleExpo (÷100)
 *   U16 dynamicThrBreakpoint — deprecated, skip
 *   U8  rcYawExpo (÷100)
 *   U8  rcYawRate (÷100)
 *   U8  rcPitchRate (÷100)
 *   U8  rcPitchExpo (÷100)
 *   U8  throttleLimitType
 *   U8  throttleLimitPercent
 *   U16 rollRateLimit
 *   U16 pitchRateLimit
 *   U16 yawRateLimit
 *   U8  ratesType
 */
export function decodeMspRcTuning(dv: DataView): MspRcTuning {
  return {
    rcRate: readU8(dv, 0) / 100,
    rcExpo: readU8(dv, 1) / 100,
    rollRate: readU8(dv, 2) / 100,
    pitchRate: readU8(dv, 3) / 100,
    yawRate: readU8(dv, 4) / 100,
    // offset 5 = dynamicThrPid (skipped)
    throttleMid: readU8(dv, 6) / 100,
    throttleExpo: readU8(dv, 7) / 100,
    // offset 8-9 = dynamicThrBreakpoint (U16, skipped)
    rcYawExpo: readU8(dv, 10) / 100,
    rcYawRate: readU8(dv, 11) / 100,
    rcPitchRate: readU8(dv, 12) / 100,
    rcPitchExpo: readU8(dv, 13) / 100,
    throttleLimitType: readU8(dv, 14),
    throttleLimitPercent: readU8(dv, 15),
    rollRateLimit: readU16(dv, 16),
    pitchRateLimit: readU16(dv, 18),
    yawRateLimit: readU16(dv, 20),
    ratesType: readU8(dv, 22),
  };
}

/**
 * MSP_FILTER_CONFIG (92)
 *
 * Full layout from MSPHelper.js (API >= 1.44):
 *   U8  gyroLowpassHz (legacy byte, overridden later by U16)
 *   U16 dtermLowpassHz
 *   U16 yawLowpassHz
 *   U16 gyroNotchHz
 *   U16 gyroNotchCutoff
 *   U16 dtermNotchHz
 *   U16 dtermNotchCutoff
 *   U16 gyroNotch2Hz
 *   U16 gyroNotch2Cutoff
 *   U8  dtermLowpassType
 *   U8  gyroHardwareLpf
 *   U8  (unused)
 *   U16 gyroLowpassHz (overrides byte 0)
 *   U16 gyroLowpass2Hz
 *   U8  gyroLowpassType
 *   U8  gyroLowpass2Type
 *   U16 dtermLowpass2Hz
 *   U8  dtermLowpass2Type
 *   U16 gyroLowpassDynMinHz
 *   U16 gyroLowpassDynMaxHz
 *   U16 dtermLowpassDynMinHz
 *   U16 dtermLowpassDynMaxHz
 *   U8  dynNotchRange
 *   U8  dynNotchWidthPercent
 *   U16 dynNotchQ
 *   U16 dynNotchMinHz
 *   U8  gyroRpmNotchHarmonics
 *   U8  gyroRpmNotchMinHz
 *   U16 dynNotchMaxHz
 *   U8  dynLpfCurveExpo
 *   U8  dynNotchCount
 */
export function decodeMspFilterConfig(dv: DataView): MspFilterConfig {
  // Offset 0: U8 gyroLowpassHz (legacy, overridden at offset 22)
  const dtermLowpassHz = readU16(dv, 1);
  const yawLowpassHz = readU16(dv, 3);
  const gyroNotchHz = readU16(dv, 5);
  const gyroNotchCutoff = readU16(dv, 7);
  const dtermNotchHz = readU16(dv, 9);
  const dtermNotchCutoff = readU16(dv, 11);
  const gyroNotch2Hz = readU16(dv, 13);
  const gyroNotch2Cutoff = readU16(dv, 15);
  const dtermLowpassType = readU8(dv, 17);
  const gyroHardwareLpf = readU8(dv, 18);
  // offset 19: unused byte
  const gyroLowpassHz = readU16(dv, 20); // overrides byte 0
  const gyroLowpass2Hz = readU16(dv, 22);
  const gyroLowpassType = readU8(dv, 24);
  const gyroLowpass2Type = readU8(dv, 25);
  const dtermLowpass2Hz = readU16(dv, 26);
  const dtermLowpass2Type = readU8(dv, 28);
  const gyroLowpassDynMinHz = readU16(dv, 29);
  const gyroLowpassDynMaxHz = readU16(dv, 31);
  const dtermLowpassDynMinHz = readU16(dv, 33);
  const dtermLowpassDynMaxHz = readU16(dv, 35);
  const dynNotchRange = readU8(dv, 37);
  const dynNotchWidthPercent = readU8(dv, 38);
  const dynNotchQ = readU16(dv, 39);
  const dynNotchMinHz = readU16(dv, 41);
  const gyroRpmNotchHarmonics = readU8(dv, 43);
  const gyroRpmNotchMinHz = readU8(dv, 44);
  const dynNotchMaxHz = readU16(dv, 45);
  const dynLpfCurveExpo = readU8(dv, 47);
  const dynNotchCount = readU8(dv, 48);

  return {
    gyroLowpassHz,
    dtermLowpassHz,
    yawLowpassHz,
    gyroNotchHz,
    gyroNotchCutoff,
    dtermNotchHz,
    dtermNotchCutoff,
    gyroNotch2Hz,
    gyroNotch2Cutoff,
    dtermLowpassType,
    gyroHardwareLpf,
    gyroLowpass2Hz,
    gyroLowpassType,
    gyroLowpass2Type,
    dtermLowpass2Hz,
    dtermLowpass2Type,
    gyroLowpassDynMinHz,
    gyroLowpassDynMaxHz,
    dtermLowpassDynMinHz,
    dtermLowpassDynMaxHz,
    dynNotchRange,
    dynNotchWidthPercent,
    dynNotchQ,
    dynNotchMinHz,
    gyroRpmNotchHarmonics,
    gyroRpmNotchMinHz,
    dynNotchMaxHz,
    dynLpfCurveExpo,
    dynNotchCount,
  };
}

/**
 * MSP_ADVANCED_CONFIG (90)
 *
 * From MSPHelper.js:
 *   U8  gyroSyncDenom
 *   U8  pidProcessDenom
 *   U8  useUnsyncedPwm
 *   U8  motorPwmProtocol
 *   U16 motorPwmRate
 *   U16 digitalIdlePercent (stored x100, divide by 100 for display)
 *   U8  gyroUse32kHz (unused)
 *   U8  motorPwmInversion
 *   U8  gyroToUse
 *   U8  gyroHighFsr
 *   U8  gyroMovementCalibThreshold
 *   U16 gyroCalibDuration
 *   U16 gyroOffsetYaw
 *   U8  gyroCheckOverflow
 *   U8  debugMode
 *   U8  debugModeCount
 */
export function decodeMspAdvancedConfig(dv: DataView): MspAdvancedConfig {
  return {
    gyroSyncDenom: readU8(dv, 0),
    pidProcessDenom: readU8(dv, 1),
    useUnsyncedPwm: readU8(dv, 2),
    motorPwmProtocol: readU8(dv, 3),
    motorPwmRate: readU16(dv, 4),
    digitalIdlePercent: readU16(dv, 6) / 100,
    gyroUse32kHz: readU8(dv, 8),
    motorPwmInversion: readU8(dv, 9),
    gyroToUse: readU8(dv, 10),
    gyroHighFsr: readU8(dv, 11),
    gyroMovementCalibThreshold: readU8(dv, 12),
    gyroCalibDuration: readU16(dv, 13),
    gyroOffsetYaw: readU16(dv, 15),
    gyroCheckOverflow: readU8(dv, 17),
    debugMode: readU8(dv, 18),
    debugModeCount: readU8(dv, 19),
  };
}

/**
 * MSP_FAILSAFE_CONFIG (75)
 *   U8  delay
 *   U8  offDelay
 *   U16 throttle
 *   U8  switchMode
 *   U16 throttleLowDelay
 *   U8  procedure
 */
export function decodeMspFailsafeConfig(dv: DataView): MspFailsafeConfig {
  return {
    delay: readU8(dv, 0),
    offDelay: readU8(dv, 1),
    throttle: readU16(dv, 2),
    switchMode: readU8(dv, 4),
    throttleLowDelay: readU16(dv, 5),
    procedure: readU8(dv, 7),
  };
}

/**
 * MSP_CF_SERIAL_CONFIG (54)
 *
 * From MSPHelper.js (MSPv1 path):
 *   7 bytes per port: U8 identifier, U16 functions, U8 msp, U8 gps, U8 telem, U8 blackbox
 *   The baud rate fields are indices into the BAUD_RATES array.
 *   We return raw indices; the consumer maps to actual baud rates.
 */
export function decodeMspSerialConfig(dv: DataView): MspSerialConfig {
  const bytesPerPort = 7; // U8 + U16 + 4*U8
  const portCount = dv.byteLength / bytesPerPort;
  const ports: MspSerialPort[] = [];
  for (let i = 0; i < portCount; i++) {
    const off = i * bytesPerPort;
    ports.push({
      identifier: readU8(dv, off),
      functions: readU16(dv, off + 1),
      mspBaudRate: readU8(dv, off + 3),
      gpsBaudRate: readU8(dv, off + 4),
      telemetryBaudRate: readU8(dv, off + 5),
      blackboxBaudRate: readU8(dv, off + 6),
    });
  }
  return { ports };
}

/**
 * MSP_OSD_CONFIG (84)
 *
 * The OSD config format is complex and version-dependent.
 * We extract the core fields that are stable across API versions.
 * OSD element positions are read from the remaining bytes.
 *
 * Note: Betaflight's OSD config handling is done in the OSD tab,
 * not in MSPHelper.js's process_data. We implement a simplified version.
 */
export function decodeMspOsdConfig(dv: DataView): MspOsdConfig {
  if (dv.byteLength === 0) {
    return { flags: 0, videoSystem: 0, units: 0, rssiAlarm: 0, capacityWarning: 0, items: [] };
  }

  const flags = readU8(dv, 0);
  const videoSystem = readU8(dv, 1);
  const units = readU8(dv, 2);
  const rssiAlarm = readU8(dv, 3);
  const capacityWarning = readU16(dv, 4);

  // Remaining bytes are U16 item positions
  const itemOffset = 6;
  const items: Array<{ position: number }> = [];
  for (let i = itemOffset; i + 1 < dv.byteLength; i += 2) {
    items.push({ position: readU16(dv, i) });
  }

  return { flags, videoSystem, units, rssiAlarm, capacityWarning, items };
}

/**
 * MSP_LED_STRIP_CONFIG (48)
 * Each LED config is a packed U32. Variable count.
 * Last 2 bytes are profile support flag + current profile.
 */
export function decodeMspLedStripConfig(dv: DataView): MspLedStripConfig {
  // Subtract 2 bytes for profile metadata at the end
  const ledCount = (dv.byteLength - 2) / 4;
  const leds: number[] = [];
  for (let i = 0; i < ledCount; i++) {
    leds.push(readU32(dv, i * 4));
  }
  return { leds };
}

/**
 * MSP_VTX_CONFIG (88)
 *
 * From MSPHelper.js:
 *   U8  type
 *   U8  band
 *   U8  channel
 *   U8  power
 *   U8  pitMode (bool)
 *   U16 frequency
 *   U8  deviceReady (bool)
 *   U8  lowPowerDisarm
 *   U16 pitModeFrequency
 *   U8  vtxTableAvailable (bool)
 *   U8  vtxTableBands
 *   U8  vtxTableChannels
 *   U8  vtxTablePowerLevels
 */
export function decodeMspVtxConfig(dv: DataView): MspVtxConfig {
  return {
    type: readU8(dv, 0),
    band: readU8(dv, 1),
    channel: readU8(dv, 2),
    power: readU8(dv, 3),
    pitMode: readU8(dv, 4) !== 0,
    frequency: readU16(dv, 5),
    deviceReady: readU8(dv, 7) !== 0,
    lowPowerDisarm: readU8(dv, 8),
    pitModeFrequency: readU16(dv, 9),
    vtxTableAvailable: readU8(dv, 11) !== 0,
    vtxTableBands: readU8(dv, 12),
    vtxTableChannels: readU8(dv, 13),
    vtxTablePowerLevels: readU8(dv, 14),
  };
}

/**
 * MSP_GPS_CONFIG (132)
 *   U8 provider
 *   U8 sbasMode
 *   U8 autoConfig
 *   U8 autoBaud
 *   U8 homePointOnce
 *   U8 ubloxUseGalileo
 */
export function decodeMspGpsConfig(dv: DataView): MspGpsConfig {
  return {
    provider: readU8(dv, 0),
    sbasMode: readU8(dv, 1),
    autoConfig: readU8(dv, 2),
    autoBaud: readU8(dv, 3),
    homePointOnce: readU8(dv, 4),
    ubloxUseGalileo: readU8(dv, 5),
  };
}

/**
 * MSP_GPS_RESCUE (135)
 *
 * From MSPHelper.js:
 *   U16 angle
 *   U16 returnAltitudeM
 *   U16 descentDistanceM
 *   U16 groundSpeed
 *   U16 throttleMin
 *   U16 throttleMax
 *   U16 throttleHover
 *   U8  sanityChecks
 *   U8  minSats
 *   U16 ascendRate
 *   U16 descendRate
 *   U8  allowArmingWithoutFix
 *   U8  altitudeMode
 */
export function decodeMspGpsRescue(dv: DataView): MspGpsRescue {
  return {
    angle: readU16(dv, 0),
    initialAltitudeM: readU16(dv, 2),
    descentDistanceM: readU16(dv, 4),
    groundSpeed: readU16(dv, 6),
    throttleMin: readU16(dv, 8),
    throttleMax: readU16(dv, 10),
    throttleHover: readU16(dv, 12),
    sanityChecks: readU8(dv, 14),
    minSats: readU8(dv, 15),
    ascendRate: readU16(dv, 16),
    descendRate: readU16(dv, 18),
    allowArmingWithoutFix: readU8(dv, 20),
    altitudeMode: readU8(dv, 21),
  };
}

/**
 * MSP_BLACKBOX_CONFIG (80)
 *
 * From MSPHelper.js:
 *   U8  supported (bit 0)
 *   U8  device
 *   U8  rateNum
 *   U8  rateDenom
 *   U16 pDenom
 *   U8  sampleRate
 */
export function decodeMspBlackboxConfig(dv: DataView): MspBlackboxConfig {
  return {
    supported: (readU8(dv, 0) & 1) !== 0,
    device: readU8(dv, 1),
    rateNum: readU8(dv, 2),
    rateDenom: readU8(dv, 3),
    pDenom: readU16(dv, 4),
    sampleRate: readU8(dv, 6),
  };
}

/**
 * MSP_DATAFLASH_SUMMARY (70)
 *
 * From MSPHelper.js:
 *   U8  flags (bit0=ready, bit1=supported)
 *   U32 sectors
 *   U32 totalSize
 *   U32 usedSize
 */
export function decodeMspDataflashSummary(dv: DataView): MspDataflashSummary {
  if (dv.byteLength < 13) {
    return { ready: false, supported: false, sectors: 0, totalSize: 0, usedSize: 0 };
  }
  const flags = readU8(dv, 0);
  return {
    ready: (flags & 1) !== 0,
    supported: (flags & 2) !== 0,
    sectors: readU32(dv, 1),
    totalSize: readU32(dv, 5),
    usedSize: readU32(dv, 9),
  };
}
