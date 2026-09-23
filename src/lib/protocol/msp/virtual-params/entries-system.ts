/**
 * Virtual-parameter definitions for flight system: motor, battery,
 * feature flags, failsafe, arming, and beeper.
 *
 * @module protocol/msp/virtual-params/entries-system
 */

import {
  MSP_MOTOR_CONFIG, MSP_SET_MOTOR_CONFIG,
  MSP_BATTERY_CONFIG, MSP_SET_BATTERY_CONFIG,
  MSP_FEATURE_CONFIG, MSP_SET_FEATURE_CONFIG,
  MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG,
  MSP_ARMING_CONFIG, MSP_SET_ARMING_CONFIG,
  MSP_BEEPER_CONFIG, MSP_SET_BEEPER_CONFIG,
  getU16, getU32, setU8, setU16, setU32,
  u8Param, u16Param, u32Param,
  type VirtualParamDef,
} from "./types";

const entries: Array<[string, VirtualParamDef]> = [];

// ── Motor Config (MSP_MOTOR_CONFIG=131, MSP_SET_MOTOR_CONFIG=222) ──
entries.push([
  'BF_MOTOR_MIN_THROTTLE',
  u16Param(MSP_MOTOR_CONFIG, MSP_SET_MOTOR_CONFIG, 0, 0, 'Motor Min Throttle', 1000, 2000),
]);
entries.push([
  'BF_MOTOR_MAX_THROTTLE',
  u16Param(MSP_MOTOR_CONFIG, MSP_SET_MOTOR_CONFIG, 2, 2, 'Motor Max Throttle', 1000, 2000),
]);
entries.push([
  'BF_MOTOR_MIN_COMMAND',
  u16Param(MSP_MOTOR_CONFIG, MSP_SET_MOTOR_CONFIG, 4, 4, 'Motor Min Command', 0, 2000),
]);
entries.push([
  'BF_MOTOR_POLES',
  // Read offset 7, write offset 6 (write payload is shorter — no motorCount)
  u8Param(MSP_MOTOR_CONFIG, MSP_SET_MOTOR_CONFIG, 7, 6, 'Motor Poles', 2, 36),
]);
entries.push([
  'BF_MOTOR_USE_DSHOT_TELEMETRY',
  u8Param(MSP_MOTOR_CONFIG, MSP_SET_MOTOR_CONFIG, 8, 7, 'DShot Telemetry', 0, 1),
]);

// ── Battery Config (MSP_BATTERY_CONFIG=32, MSP_SET_BATTERY_CONFIG=33) ──
// Read: legacy U8s at 0-2, then U16 capacity at 3, U8 voltSrc at 5, U8 currSrc at 6, then U16÷100 at 7,9,11
// Write: same layout
entries.push([
  'BF_BATT_MIN_CELL',
  {
    readCmd: MSP_BATTERY_CONFIG,
    writeCmd: MSP_SET_BATTERY_CONFIG,
    readEnd: 9,
    decode: (p) => getU16(p, 7), // U16÷100 (raw value, consumer divides)
    encode: (v, p) => {
      let out = setU8(p, 0, Math.round(v / 10)); // legacy U8 (÷10 stored)
      out = setU16(out, 7, v); // U16 (÷100 stored)
      return out;
    },
    type: 'uint16',
    min: 100,
    max: 500,
    description: 'Min cell voltage (×100)',
  },
]);
entries.push([
  'BF_BATT_MAX_CELL',
  {
    readCmd: MSP_BATTERY_CONFIG,
    writeCmd: MSP_SET_BATTERY_CONFIG,
    readEnd: 11,
    decode: (p) => getU16(p, 9),
    encode: (v, p) => {
      let out = setU8(p, 1, Math.round(v / 10));
      out = setU16(out, 9, v);
      return out;
    },
    type: 'uint16',
    min: 100,
    max: 500,
    description: 'Max cell voltage (×100)',
  },
]);
entries.push([
  'BF_BATT_WARNING_CELL',
  {
    readCmd: MSP_BATTERY_CONFIG,
    writeCmd: MSP_SET_BATTERY_CONFIG,
    readEnd: 13,
    decode: (p) => getU16(p, 11),
    encode: (v, p) => {
      let out = setU8(p, 2, Math.round(v / 10));
      out = setU16(out, 11, v);
      return out;
    },
    type: 'uint16',
    min: 100,
    max: 500,
    description: 'Warning cell voltage (×100)',
  },
]);
entries.push([
  'BF_BATT_CAPACITY',
  u16Param(MSP_BATTERY_CONFIG, MSP_SET_BATTERY_CONFIG, 3, 3, 'Battery Capacity (mAh)', 0, 20000),
]);
entries.push([
  'BF_BATT_VOLTAGE_METER_SOURCE',
  u8Param(MSP_BATTERY_CONFIG, MSP_SET_BATTERY_CONFIG, 5, 5, 'Voltage Meter Source', 0, 3),
]);
entries.push([
  'BF_BATT_CURRENT_METER_SOURCE',
  u8Param(MSP_BATTERY_CONFIG, MSP_SET_BATTERY_CONFIG, 6, 6, 'Current Meter Source', 0, 3),
]);


// ── Feature Config (MSP_FEATURE_CONFIG=36, MSP_SET_FEATURE_CONFIG=37) ──
entries.push([
  'BF_FEATURE_MASK',
  u32Param(MSP_FEATURE_CONFIG, MSP_SET_FEATURE_CONFIG, 0, 0, 'Feature bitmask'),
]);


// ── Failsafe Config (MSP_FAILSAFE_CONFIG=75, MSP_SET_FAILSAFE_CONFIG=76) ──
entries.push([
  'BF_FS_DELAY',
  u8Param(MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG, 0, 0, 'Failsafe Delay (0.1s)', 0, 200),
]);
entries.push([
  'BF_FS_OFF_DELAY',
  u8Param(MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG, 1, 1, 'Failsafe Off Delay (0.1s)', 0, 200),
]);
entries.push([
  'BF_FS_THROTTLE',
  u16Param(MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG, 2, 2, 'Failsafe Throttle', 1000, 2000),
]);
entries.push([
  'BF_FS_SWITCH_MODE',
  u8Param(MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG, 4, 4, 'Failsafe Switch Mode', 0, 2),
]);
entries.push([
  'BF_FS_THROTTLE_LOW_DELAY',
  u16Param(MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG, 5, 5, 'Throttle Low Delay (0.1s)', 0, 300),
]);
entries.push([
  'BF_FS_PROCEDURE',
  u8Param(MSP_FAILSAFE_CONFIG, MSP_SET_FAILSAFE_CONFIG, 7, 7, 'Failsafe Procedure', 0, 2),
]);

// ── Arming Config (MSP_ARMING_CONFIG=61, MSP_SET_ARMING_CONFIG=62) ──
entries.push([
  'BF_AUTO_DISARM_DELAY',
  u8Param(MSP_ARMING_CONFIG, MSP_SET_ARMING_CONFIG, 0, 0, 'Auto Disarm Delay (s)', 0, 60),
]);
entries.push([
  'BF_SMALL_ANGLE',
  // Read: offset 2 (skip deprecated kill_switch at 1). Write: offset 2.
  u8Param(MSP_ARMING_CONFIG, MSP_SET_ARMING_CONFIG, 2, 2, 'Small Angle (degrees)', 0, 180),
]);


// ── Beeper Config (MSP_BEEPER_CONFIG=184, MSP_SET_BEEPER_CONFIG=185) ──
entries.push([
  'BF_BEEPER_DISABLED_MASK',
  u32Param(MSP_BEEPER_CONFIG, MSP_SET_BEEPER_CONFIG, 0, 0, 'Beeper Disabled Mask'),
]);
entries.push([
  'BF_BEEPER_DSHOT_TONE',
  u8Param(MSP_BEEPER_CONFIG, MSP_SET_BEEPER_CONFIG, 4, 4, 'DShot Beacon Tone', 0, 5),
]);
entries.push([
  'BF_BEEPER_DSHOT_CONDITIONS_MASK',
  u32Param(MSP_BEEPER_CONFIG, MSP_SET_BEEPER_CONFIG, 5, 5, 'DShot Beacon Conditions Mask'),
]);


export { entries };
