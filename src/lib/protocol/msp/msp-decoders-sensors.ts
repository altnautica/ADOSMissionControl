/**
 * MSP decoders — Sensor data, GPS, battery, and analog readings.
 *
 * @module protocol/msp/msp-decoders-sensors
 */

import { readU8, readU16, readS16, readS32 } from './msp-decode-utils';

// ── Types ────────────────────────────────────────────────────

export interface MspAttitude {
  roll: number;
  pitch: number;
  yaw: number;
}

export interface MspAnalog {
  voltage: number;
  mAhDrawn: number;
  rssi: number;
  amperage: number;
}

export interface MspRawImu {
  accX: number;
  accY: number;
  accZ: number;
  gyrX: number;
  gyrY: number;
  gyrZ: number;
  magX: number;
  magY: number;
  magZ: number;
}

export interface MspAltitude {
  altitude: number;
  vario: number;
}

export interface MspRawGps {
  fixType: number;
  numSat: number;
  lat: number;
  lon: number;
  alt: number;
  speed: number;
  groundCourse: number;
}

export interface MspBatteryState {
  cellCount: number;
  capacity: number;
  voltage: number;
  mAhDrawn: number;
  amperage: number;
  state: number;
}

export interface MspBatteryConfig {
  vbatMinCellVoltage: number;
  vbatMaxCellVoltage: number;
  vbatWarningCellVoltage: number;
  capacity: number;
  voltageMeterSource: number;
  currentMeterSource: number;
}

// ── Decoders ─────────────────────────────────────────────────

/**
 * MSP_ATTITUDE (108)
 * S16 roll (÷10 = degrees), S16 pitch (÷10), S16 yaw (degrees, NOT ÷10)
 */
export function decodeMspAttitude(dv: DataView): MspAttitude {
  return {
    roll: readS16(dv, 0) / 10.0,
    pitch: readS16(dv, 2) / 10.0,
    yaw: readS16(dv, 4),
  };
}

/**
 * MSP_ANALOG (110)
 *
 * From MSPHelper.js:
 *   U8  voltage (÷10, legacy)
 *   U16 mAhDrawn
 *   U16 rssi (0-1023)
 *   S16 amperage (÷100)
 *   U16 voltage (÷100, newer — overrides legacy)
 */
export function decodeMspAnalog(dv: DataView): MspAnalog {
  // Legacy voltage at offset 0 (U8÷10), overridden by U16 at offset 7
  const mAhDrawn = readU16(dv, 1);
  const rssi = readU16(dv, 3);
  const amperage = readS16(dv, 5) / 100;
  const voltage = readU16(dv, 7) / 100;

  return { voltage, mAhDrawn, rssi, amperage };
}

/**
 * MSP_RAW_IMU (102)
 * 9 S16 values: accX, accY, accZ, gyrX, gyrY, gyrZ, magX, magY, magZ
 */
export function decodeMspRawImu(dv: DataView): MspRawImu {
  return {
    accX: readS16(dv, 0),
    accY: readS16(dv, 2),
    accZ: readS16(dv, 4),
    gyrX: readS16(dv, 6),
    gyrY: readS16(dv, 8),
    gyrZ: readS16(dv, 10),
    magX: readS16(dv, 12),
    magY: readS16(dv, 14),
    magZ: readS16(dv, 16),
  };
}

/**
 * MSP_ALTITUDE (109)
 * S32 altitude (÷100 = meters), S16 vario (if present)
 */
export function decodeMspAltitude(dv: DataView): MspAltitude {
  return {
    altitude: readS32(dv, 0) / 100.0,
    vario: dv.byteLength >= 6 ? readS16(dv, 4) : 0,
  };
}

/**
 * MSP_RAW_GPS (106)
 *
 * From MSPHelper.js:
 *   U8  fixType
 *   U8  numSat
 *   S32 lat (÷1e7)
 *   S32 lon (÷1e7)
 *   U16 alt (meters)
 *   U16 speed (cm/s)
 *   U16 groundCourse (÷10 degrees)
 */
export function decodeMspRawGps(dv: DataView): MspRawGps {
  return {
    fixType: readU8(dv, 0),
    numSat: readU8(dv, 1),
    lat: readS32(dv, 2) / 1e7,
    lon: readS32(dv, 6) / 1e7,
    alt: readU16(dv, 10),
    speed: readU16(dv, 12),
    groundCourse: readU16(dv, 14) / 10,
  };
}

/**
 * MSP_BATTERY_STATE (130)
 *
 * From MSPHelper.js:
 *   U8  cellCount
 *   U16 capacity (mAh)
 *   U8  voltage (÷10, legacy)
 *   U16 mAhDrawn
 *   U16 amperage (÷100)
 *   U8  state
 *   U16 voltage (÷100, newer — overrides)
 */
export function decodeMspBatteryState(dv: DataView): MspBatteryState {
  const cellCount = readU8(dv, 0);
  const capacity = readU16(dv, 1);
  // offset 3: U8 voltage (legacy, overridden at offset 9)
  const mAhDrawn = readU16(dv, 4);
  const amperage = readU16(dv, 6) / 100;
  const state = readU8(dv, 8);
  const voltage = readU16(dv, 9) / 100;

  return { cellCount, capacity, voltage, mAhDrawn, amperage, state };
}

/**
 * MSP_BATTERY_CONFIG (32)
 *
 * From MSPHelper.js:
 *   U8  vbatMinCellVoltage (÷10, legacy)
 *   U8  vbatMaxCellVoltage (÷10, legacy)
 *   U8  vbatWarningCellVoltage (÷10, legacy)
 *   U16 capacity
 *   U8  voltageMeterSource
 *   U8  currentMeterSource
 *   U16 vbatMinCellVoltage (÷100, newer — overrides)
 *   U16 vbatMaxCellVoltage (÷100, newer — overrides)
 *   U16 vbatWarningCellVoltage (÷100, newer — overrides)
 */
export function decodeMspBatteryConfig(dv: DataView): MspBatteryConfig {
  const capacity = readU16(dv, 3);
  const voltageMeterSource = readU8(dv, 5);
  const currentMeterSource = readU8(dv, 6);
  // Newer U16÷100 values override legacy U8÷10
  const vbatMinCellVoltage = readU16(dv, 7) / 100;
  const vbatMaxCellVoltage = readU16(dv, 9) / 100;
  const vbatWarningCellVoltage = readU16(dv, 11) / 100;

  return {
    vbatMinCellVoltage,
    vbatMaxCellVoltage,
    vbatWarningCellVoltage,
    capacity,
    voltageMeterSource,
    currentMeterSource,
  };
}
