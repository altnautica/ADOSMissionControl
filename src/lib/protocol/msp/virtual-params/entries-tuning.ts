/**
 * Virtual-parameter definitions for tuning: PID, RC tuning, filters,
 * advanced tuning.
 *
 * @module protocol/msp/virtual-params/entries-tuning
 */

import {
  MSP_PID, MSP_SET_PID,
  MSP_PID_ADVANCED, MSP_SET_PID_ADVANCED,
  MSP_RC_TUNING, MSP_SET_RC_TUNING,
  MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG,
  MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG,
  getU16, getS16, setU16,
  u8Param, u16Param,
  type VirtualParamDef,
} from "./types";

const entries: Array<[string, VirtualParamDef]> = [];

// ── PID params (MSP_PID=112, MSP_SET_PID=202) ──
// Payload: 3 bytes per axis. Axes: ROLL=0, PITCH=1, YAW=2, ALT=3, POS=4, POSR=5, NAVR=6, LEVEL=7, MAG=8, VEL=9
// Axis n: P at n*3, I at n*3+1, D at n*3+2

const PID_AXES = ['ROLL', 'PITCH', 'YAW', 'ALT', 'POS', 'POSR', 'NAVR', 'LEVEL', 'MAG', 'VEL'] as const;
for (let ax = 0; ax < PID_AXES.length; ax++) {
  const name = PID_AXES[ax];
  entries.push([`BF_PID_${name}_P`, u8Param(MSP_PID, MSP_SET_PID, ax * 3, ax * 3, `${name} P gain`, 0, 255)]);
  entries.push([`BF_PID_${name}_I`, u8Param(MSP_PID, MSP_SET_PID, ax * 3 + 1, ax * 3 + 1, `${name} I gain`, 0, 255)]);
  entries.push([`BF_PID_${name}_D`, u8Param(MSP_PID, MSP_SET_PID, ax * 3 + 2, ax * 3 + 2, `${name} D gain`, 0, 255)]);
}

// ── Feedforward (MSP_PID_ADVANCED=94, MSP_SET_PID_ADVANCED=95) ──
// Both directions carry the per-axis feedforward gain as U16 at 32/34/36,
// after the fixed advanced-tuning block.
const FF_AXES = [['ROLL', 32], ['PITCH', 34], ['YAW', 36]] as const;
for (const [name, offset] of FF_AXES) {
  entries.push([`BF_PID_${name}_F`, u16Param(MSP_PID_ADVANCED, MSP_SET_PID_ADVANCED, offset, offset, `${name} feedforward`, 0, 2000)]);
}

// ── RC Tuning (MSP_RC_TUNING=111, MSP_SET_RC_TUNING=204) ──
// Read offsets match decodeMspRcTuning; write offsets match encodeMspSetRcTuning.
// Values stored as U8 (÷100 for display), we store raw bytes.
entries.push([
  'BF_RC_RATE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 0, 0, 'RC Rate', 0, 255),
]);
entries.push([
  'BF_RC_EXPO',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 1, 1, 'RC Expo', 0, 255),
]);
entries.push([
  'BF_ROLL_RATE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 2, 2, 'Roll Rate', 0, 255),
]);
entries.push([
  'BF_PITCH_RATE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 3, 3, 'Pitch Rate', 0, 255),
]);
entries.push([
  'BF_YAW_RATE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 4, 4, 'Yaw Rate', 0, 255),
]);
entries.push([
  'BF_THROTTLE_MID',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 6, 6, 'Throttle Mid', 0, 255),
]);
entries.push([
  'BF_THROTTLE_EXPO',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 7, 7, 'Throttle Expo', 0, 255),
]);
entries.push([
  'BF_RC_YAW_EXPO',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 10, 10, 'RC Yaw Expo', 0, 255),
]);
entries.push([
  'BF_RC_YAW_RATE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 11, 11, 'RC Yaw Rate', 0, 255),
]);
entries.push([
  'BF_RC_PITCH_RATE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 12, 12, 'RC Pitch Rate', 0, 255),
]);
entries.push([
  'BF_RC_PITCH_EXPO',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 13, 13, 'RC Pitch Expo', 0, 255),
]);
entries.push([
  'BF_THROTTLE_LIMIT_TYPE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 14, 14, 'Throttle Limit Type', 0, 2),
]);
entries.push([
  'BF_THROTTLE_LIMIT_PERCENT',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 15, 15, 'Throttle Limit Percent', 25, 100),
]);
entries.push([
  'BF_ROLL_RATE_LIMIT',
  u16Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 16, 16, 'Roll Rate Limit', 200, 1998),
]);
entries.push([
  'BF_PITCH_RATE_LIMIT',
  u16Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 18, 18, 'Pitch Rate Limit', 200, 1998),
]);
entries.push([
  'BF_YAW_RATE_LIMIT',
  u16Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 20, 20, 'Yaw Rate Limit', 200, 1998),
]);
entries.push([
  'BF_RATES_TYPE',
  u8Param(MSP_RC_TUNING, MSP_SET_RC_TUNING, 22, 22, 'Rates Type', 0, 5),
]);


// ── Filter Config (MSP_FILTER_CONFIG=92, MSP_SET_FILTER_CONFIG=93) ──
// Read offsets from decodeMspFilterConfig, write offsets from encodeMspSetFilterConfig
// Note: gyroLowpassHz legacy byte at 0, real U16 at 20 (read) / 20 (write)
entries.push([
  'BF_GYRO_LPF_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 20, 20, 'Gyro Lowpass Hz', 0, 4000),
]);
entries.push([
  'BF_DTERM_LPF_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 1, 1, 'D-term Lowpass Hz', 0, 4000),
]);
entries.push([
  'BF_YAW_LPF_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 3, 3, 'Yaw Lowpass Hz', 0, 500),
]);
entries.push([
  'BF_GYRO_NOTCH_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 5, 5, 'Gyro Notch Hz', 0, 4000),
]);
entries.push([
  'BF_GYRO_NOTCH_CUTOFF',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 7, 7, 'Gyro Notch Cutoff', 0, 4000),
]);
entries.push([
  'BF_DTERM_NOTCH_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 9, 9, 'D-term Notch Hz', 0, 4000),
]);
entries.push([
  'BF_DTERM_NOTCH_CUTOFF',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 11, 11, 'D-term Notch Cutoff', 0, 4000),
]);
entries.push([
  'BF_GYRO_NOTCH2_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 13, 13, 'Gyro Notch 2 Hz', 0, 4000),
]);
entries.push([
  'BF_GYRO_NOTCH2_CUTOFF',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 15, 15, 'Gyro Notch 2 Cutoff', 0, 4000),
]);
entries.push([
  'BF_DTERM_LPF_TYPE',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 17, 17, 'D-term Lowpass Type', 0, 2),
]);
entries.push([
  'BF_GYRO_HARDWARE_LPF',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 18, 18, 'Gyro Hardware LPF', 0, 2),
]);
entries.push([
  'BF_GYRO_LPF2_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 22, 22, 'Gyro Lowpass 2 Hz', 0, 4000),
]);
entries.push([
  'BF_GYRO_LPF_TYPE',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 24, 24, 'Gyro Lowpass Type', 0, 2),
]);
entries.push([
  'BF_GYRO_LPF2_TYPE',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 25, 25, 'Gyro Lowpass 2 Type', 0, 2),
]);
entries.push([
  'BF_DTERM_LPF2_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 26, 26, 'D-term Lowpass 2 Hz', 0, 4000),
]);
entries.push([
  'BF_DTERM_LPF2_TYPE',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 28, 28, 'D-term Lowpass 2 Type', 0, 2),
]);
entries.push([
  'BF_GYRO_LPF_DYN_MIN_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 29, 29, 'Gyro Dyn LPF Min Hz', 0, 1000),
]);
entries.push([
  'BF_GYRO_LPF_DYN_MAX_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 31, 31, 'Gyro Dyn LPF Max Hz', 0, 1000),
]);
entries.push([
  'BF_DTERM_LPF_DYN_MIN_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 33, 33, 'D-term Dyn LPF Min Hz', 0, 1000),
]);
entries.push([
  'BF_DTERM_LPF_DYN_MAX_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 35, 35, 'D-term Dyn LPF Max Hz', 0, 1000),
]);
entries.push([
  'BF_DYN_NOTCH_Q',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 39, 39, 'Dynamic Notch Q', 0, 1000),
]);
entries.push([
  'BF_DYN_NOTCH_MIN_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 41, 41, 'Dynamic Notch Min Hz', 0, 1000),
]);
entries.push([
  'BF_RPM_NOTCH_HARMONICS',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 43, 43, 'RPM Notch Harmonics', 0, 3),
]);
entries.push([
  'BF_RPM_NOTCH_MIN_HZ',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 44, 44, 'RPM Notch Min Hz', 0, 255),
]);
entries.push([
  'BF_DYN_NOTCH_MAX_HZ',
  u16Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 45, 45, 'Dynamic Notch Max Hz', 0, 1000),
]);
entries.push([
  'BF_DYN_NOTCH_COUNT',
  u8Param(MSP_FILTER_CONFIG, MSP_SET_FILTER_CONFIG, 48, 48, 'Dynamic Notch Count', 0, 5),
]);


// ── Advanced Config (MSP_ADVANCED_CONFIG=90, MSP_SET_ADVANCED_CONFIG=91) ──
entries.push([
  'BF_GYRO_SYNC_DENOM',
  u8Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 0, 0, 'Gyro Sync Denominator', 1, 32),
]);
entries.push([
  'BF_PID_PROCESS_DENOM',
  u8Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 1, 1, 'PID Process Denominator', 1, 16),
]);
entries.push([
  'BF_MOTOR_PWM_PROTOCOL',
  u8Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 3, 3, 'Motor PWM Protocol', 0, 9),
]);
entries.push([
  'BF_MOTOR_PWM_RATE',
  u16Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 4, 4, 'Motor PWM Rate', 200, 32000),
]);
entries.push([
  'BF_MOTOR_IDLE_PCT',
  // Read: U16 at offset 6 (stored ×100). Write: U16 at offset 6.
  // decode/encode handle the raw ×100 value; consumer divides by 100 for display.
  u16Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 6, 6, 'Motor Idle (×100)', 0, 3000),
]);
entries.push([
  'BF_MOTOR_PWM_INVERSION',
  u8Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 9, 9, 'Motor PWM Inversion', 0, 1),
]);
entries.push([
  'BF_GYRO_TO_USE',
  u8Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 10, 10, 'Gyro to Use', 0, 2),
]);
entries.push([
  'BF_DEBUG_MODE',
  u8Param(MSP_ADVANCED_CONFIG, MSP_SET_ADVANCED_CONFIG, 18, 18, 'Debug Mode', 0, 255),
]);


export { entries };
