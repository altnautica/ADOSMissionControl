/**
 * Virtual-parameter definitions for peripherals: GPS config, GPS rescue,
 * blackbox logging, and VTX.
 *
 * @module protocol/msp/virtual-params/entries-peripherals
 */

import {
  MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG,
  MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE,
  MSP_BLACKBOX_CONFIG, MSP_SET_BLACKBOX_CONFIG,
  MSP_VTX_CONFIG, MSP_SET_VTX_CONFIG,
  getU8, getU16, setU8, setU16,
  u8Param, u16Param,
  type VirtualParamDef,
} from "./types";

const entries: Array<[string, VirtualParamDef]> = [];

// ── GPS Config (MSP_GPS_CONFIG=132, MSP_SET_GPS_CONFIG=223) ──
entries.push([
  'BF_GPS_PROVIDER',
  u8Param(MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG, 0, 0, 'GPS Provider', 0, 3),
]);
entries.push([
  'BF_GPS_SBAS_MODE',
  u8Param(MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG, 1, 1, 'GPS SBAS Mode', 0, 4),
]);
entries.push([
  'BF_GPS_AUTO_CONFIG',
  u8Param(MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG, 2, 2, 'GPS Auto Config', 0, 1),
]);
entries.push([
  'BF_GPS_AUTO_BAUD',
  u8Param(MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG, 3, 3, 'GPS Auto Baud', 0, 1),
]);
entries.push([
  'BF_GPS_HOME_POINT_ONCE',
  u8Param(MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG, 4, 4, 'GPS Home Point Once', 0, 1),
]);
entries.push([
  'BF_GPS_USE_GALILEO',
  u8Param(MSP_GPS_CONFIG, MSP_SET_GPS_CONFIG, 5, 5, 'GPS Use Galileo', 0, 1),
]);

// ── GPS Rescue (MSP_GPS_RESCUE=135, MSP_SET_GPS_RESCUE=225) ──
entries.push([
  'BF_GPS_RESCUE_ANGLE',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 0, 0, 'GPS Rescue Angle', 0, 200),
]);
entries.push([
  'BF_GPS_RESCUE_INITIAL_ALT',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 2, 2, 'GPS Rescue Initial Altitude (m)', 20, 100),
]);
entries.push([
  'BF_GPS_RESCUE_DESCENT_DIST',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 4, 4, 'GPS Rescue Descent Distance (m)', 30, 500),
]);
entries.push([
  'BF_GPS_RESCUE_GROUND_SPEED',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 6, 6, 'GPS Rescue Ground Speed (cm/s)', 0, 2000),
]);
entries.push([
  'BF_GPS_RESCUE_THROTTLE_MIN',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 8, 8, 'GPS Rescue Throttle Min', 1000, 2000),
]);
entries.push([
  'BF_GPS_RESCUE_THROTTLE_MAX',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 10, 10, 'GPS Rescue Throttle Max', 1000, 2000),
]);
entries.push([
  'BF_GPS_RESCUE_THROTTLE_HOVER',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 12, 12, 'GPS Rescue Throttle Hover', 1000, 2000),
]);
entries.push([
  'BF_GPS_RESCUE_SANITY_CHECKS',
  u8Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 14, 14, 'GPS Rescue Sanity Checks', 0, 2),
]);
entries.push([
  'BF_GPS_RESCUE_MIN_SATS',
  u8Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 15, 15, 'GPS Rescue Min Satellites', 0, 50),
]);
entries.push([
  'BF_GPS_RESCUE_ASCEND_RATE',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 16, 16, 'GPS Rescue Ascend Rate', 100, 2500),
]);
entries.push([
  'BF_GPS_RESCUE_DESCEND_RATE',
  u16Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 18, 18, 'GPS Rescue Descend Rate', 100, 500),
]);
entries.push([
  'BF_GPS_RESCUE_ALLOW_ARMING_NO_FIX',
  u8Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 20, 20, 'GPS Rescue Allow Arming Without Fix', 0, 1),
]);
entries.push([
  'BF_GPS_RESCUE_ALTITUDE_MODE',
  u8Param(MSP_GPS_RESCUE, MSP_SET_GPS_RESCUE, 21, 21, 'GPS Rescue Altitude Mode', 0, 2),
]);


// ── Blackbox Config (MSP_BLACKBOX_CONFIG=80, MSP_SET_BLACKBOX_CONFIG=81) ──
// Read: U8 supported (bit 0), U8 device, U8 rateNum, U8 rateDenom, U16 pDenom, U8 sampleRate
// Write: U8 device, U8 rateNum, U8 rateDenom, U16 pDenom, U8 sampleRate
entries.push([
  'BF_BLACKBOX_DEVICE',
  u8Param(MSP_BLACKBOX_CONFIG, MSP_SET_BLACKBOX_CONFIG, 1, 0, 'Blackbox Device', 0, 3),
]);
entries.push([
  'BF_BLACKBOX_RATE_NUM',
  u8Param(MSP_BLACKBOX_CONFIG, MSP_SET_BLACKBOX_CONFIG, 2, 1, 'Blackbox Rate Numerator', 1, 255),
]);
entries.push([
  'BF_BLACKBOX_RATE_DENOM',
  u8Param(MSP_BLACKBOX_CONFIG, MSP_SET_BLACKBOX_CONFIG, 3, 2, 'Blackbox Rate Denominator', 1, 255),
]);
entries.push([
  'BF_BLACKBOX_P_DENOM',
  u16Param(MSP_BLACKBOX_CONFIG, MSP_SET_BLACKBOX_CONFIG, 4, 3, 'Blackbox P Denom', 0, 65535),
]);
entries.push([
  'BF_BLACKBOX_SAMPLE_RATE',
  u8Param(MSP_BLACKBOX_CONFIG, MSP_SET_BLACKBOX_CONFIG, 6, 5, 'Blackbox Sample Rate', 0, 255),
]);


// ── VTX Config (MSP_VTX_CONFIG=88, MSP_SET_VTX_CONFIG=89) ──
// Read offsets from decodeMspVtxConfig. Write offsets from encodeMspSetVtxConfig
// (the write payload is rebuilt from the read payload by the registry's
// write-layout table before any field is patched).
entries.push([
  'BF_VTX_TYPE',
  // The device type is detected by the firmware; MSP_SET_VTX_CONFIG has no
  // field for it.
  { ...u8Param(MSP_VTX_CONFIG, MSP_SET_VTX_CONFIG, 0, 0, 'VTX Type', 0, 255), readOnly: true },
]);
entries.push([
  'BF_VTX_BAND',
  // Read: offset 1. Write: offset 7.
  {
    readCmd: MSP_VTX_CONFIG,
    writeCmd: MSP_SET_VTX_CONFIG,
    readEnd: 2,
    decode: (p) => getU8(p, 1),
    encode: (v, p) => setU8(p, 7, v),
    type: 'uint8' as const,
    min: 0,
    max: 5,
    description: 'VTX Band',
  },
]);
entries.push([
  'BF_VTX_CHANNEL',
  {
    readCmd: MSP_VTX_CONFIG,
    writeCmd: MSP_SET_VTX_CONFIG,
    readEnd: 3,
    decode: (p) => getU8(p, 2),
    encode: (v, p) => setU8(p, 8, v),
    type: 'uint8' as const,
    min: 0,
    max: 8,
    description: 'VTX Channel',
  },
]);
entries.push([
  'BF_VTX_POWER',
  {
    readCmd: MSP_VTX_CONFIG,
    writeCmd: MSP_SET_VTX_CONFIG,
    readEnd: 4,
    decode: (p) => getU8(p, 3),
    encode: (v, p) => setU8(p, 2, v),
    type: 'uint8' as const,
    min: 0,
    max: 5,
    description: 'VTX Power Level',
  },
]);
entries.push([
  'BF_VTX_PIT_MODE',
  {
    readCmd: MSP_VTX_CONFIG,
    writeCmd: MSP_SET_VTX_CONFIG,
    readEnd: 5,
    decode: (p) => getU8(p, 4),
    encode: (v, p) => setU8(p, 3, v),
    type: 'uint8' as const,
    min: 0,
    max: 1,
    description: 'VTX Pit Mode',
  },
]);
entries.push([
  'BF_VTX_FREQUENCY',
  {
    readCmd: MSP_VTX_CONFIG,
    writeCmd: MSP_SET_VTX_CONFIG,
    readEnd: 7,
    decode: (p) => getU16(p, 5),
    encode: (v, p) => {
      let out = setU16(p, 0, v); // first frequency field
      out = setU16(out, 9, v); // second frequency field
      return out;
    },
    type: 'uint16' as const,
    min: 0,
    max: 5999,
    description: 'VTX Frequency (MHz)',
  },
]);
entries.push([
  'BF_VTX_LOW_POWER_DISARM',
  {
    readCmd: MSP_VTX_CONFIG,
    writeCmd: MSP_SET_VTX_CONFIG,
    readEnd: 9,
    decode: (p) => getU8(p, 8),
    encode: (v, p) => setU8(p, 4, v),
    type: 'uint8' as const,
    min: 0,
    max: 2,
    description: 'VTX Low Power Disarm',
  },
]);


export { entries };
