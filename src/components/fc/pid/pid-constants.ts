export interface PidParam {
  param: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface AxisConfig {
  axis: string;
  params: PidParam[];
}

// ── Plane PID axes (servo-rate controllers) ──────────────────

export const PLANE_AXES: AxisConfig[] = [
  {
    axis: "Roll",
    params: [
      { param: "RLL_RATE_P", label: "P", min: 0, max: 5, step: 0.001 },
      { param: "RLL_RATE_I", label: "I", min: 0, max: 5, step: 0.001 },
      { param: "RLL_RATE_D", label: "D", min: 0, max: 5, step: 0.001 },
      { param: "RLL_RATE_IMAX", label: "IMAX", min: 0, max: 1, step: 0.01 },
      { param: "RLL_RATE_FF", label: "FF", min: 0, max: 5, step: 0.001 },
    ],
  },
  {
    axis: "Pitch",
    params: [
      { param: "PTCH_RATE_P", label: "P", min: 0, max: 5, step: 0.001 },
      { param: "PTCH_RATE_I", label: "I", min: 0, max: 5, step: 0.001 },
      { param: "PTCH_RATE_D", label: "D", min: 0, max: 5, step: 0.001 },
      { param: "PTCH_RATE_IMAX", label: "IMAX", min: 0, max: 1, step: 0.01 },
      { param: "PTCH_RATE_FF", label: "FF", min: 0, max: 5, step: 0.001 },
    ],
  },
  {
    axis: "Yaw",
    params: [
      { param: "YAW2SRV_SLIP", label: "SLIP", min: 0, max: 5, step: 0.001 },
      { param: "YAW2SRV_INT", label: "INT", min: 0, max: 5, step: 0.001 },
      { param: "YAW2SRV_DAMP", label: "DAMP", min: 0, max: 5, step: 0.001 },
      { param: "YAW2SRV_RLL", label: "RLL", min: 0, max: 5, step: 0.001 },
    ],
  },
];

// ── Copter rate PID axes (ATC_RAT_*) ─────────────────────────

export const COPTER_AXES: AxisConfig[] = [
  {
    axis: "Roll Rate",
    params: [
      { param: "ATC_RAT_RLL_P", label: "P", min: 0, max: 1, step: 0.001 },
      { param: "ATC_RAT_RLL_I", label: "I", min: 0, max: 2, step: 0.001 },
      { param: "ATC_RAT_RLL_D", label: "D", min: 0, max: 0.2, step: 0.0001 },
      { param: "ATC_RAT_RLL_FF", label: "FF", min: 0, max: 1, step: 0.001 },
      { param: "ATC_RAT_RLL_FLTT", label: "FLTT", min: 0, max: 100, step: 1 },
      { param: "ATC_RAT_RLL_FLTD", label: "FLTD", min: 0, max: 100, step: 1 },
    ],
  },
  {
    axis: "Pitch Rate",
    params: [
      { param: "ATC_RAT_PIT_P", label: "P", min: 0, max: 1, step: 0.001 },
      { param: "ATC_RAT_PIT_I", label: "I", min: 0, max: 2, step: 0.001 },
      { param: "ATC_RAT_PIT_D", label: "D", min: 0, max: 0.2, step: 0.0001 },
      { param: "ATC_RAT_PIT_FF", label: "FF", min: 0, max: 1, step: 0.001 },
      { param: "ATC_RAT_PIT_FLTT", label: "FLTT", min: 0, max: 100, step: 1 },
      { param: "ATC_RAT_PIT_FLTD", label: "FLTD", min: 0, max: 100, step: 1 },
    ],
  },
  {
    axis: "Yaw Rate",
    params: [
      { param: "ATC_RAT_YAW_P", label: "P", min: 0, max: 1, step: 0.001 },
      { param: "ATC_RAT_YAW_I", label: "I", min: 0, max: 2, step: 0.001 },
      { param: "ATC_RAT_YAW_D", label: "D", min: 0, max: 0.2, step: 0.0001 },
      { param: "ATC_RAT_YAW_FF", label: "FF", min: 0, max: 1, step: 0.001 },
      { param: "ATC_RAT_YAW_FLTT", label: "FLTT", min: 0, max: 100, step: 1 },
      { param: "ATC_RAT_YAW_FLTD", label: "FLTD", min: 0, max: 100, step: 1 },
    ],
  },
];

// ── Rover PID axes (steering-rate ATC_STR_RAT_*, speed ATC_SPEED_*) ──

export const ROVER_AXES: AxisConfig[] = [
  {
    axis: "Steering Rate",
    params: [
      { param: "ATC_STR_RAT_P", label: "P", min: 0, max: 2, step: 0.001 },
      { param: "ATC_STR_RAT_I", label: "I", min: 0, max: 2, step: 0.001 },
      { param: "ATC_STR_RAT_D", label: "D", min: 0, max: 0.2, step: 0.0001 },
      { param: "ATC_STR_RAT_FF", label: "FF", min: 0, max: 3, step: 0.001 },
      { param: "ATC_STR_RAT_FLTT", label: "FLTT", min: 0, max: 100, step: 1 },
      { param: "ATC_STR_RAT_FLTD", label: "FLTD", min: 0, max: 100, step: 1 },
    ],
  },
  {
    axis: "Speed / Throttle",
    params: [
      { param: "ATC_SPEED_P", label: "P", min: 0, max: 2, step: 0.001 },
      { param: "ATC_SPEED_I", label: "I", min: 0, max: 2, step: 0.001 },
      { param: "ATC_SPEED_D", label: "D", min: 0, max: 0.2, step: 0.0001 },
      { param: "ATC_SPEED_FF", label: "FF", min: 0, max: 3, step: 0.001 },
      { param: "ATC_SPEED_FLTT", label: "FLTT", min: 0, max: 100, step: 1 },
      { param: "ATC_SPEED_FLTD", label: "FLTD", min: 0, max: 100, step: 1 },
    ],
  },
];

// ── Rover navigation / cruise params ─────────────────────────

export const ROVER_NAV_PARAMS: PidParam[] = [
  { param: "ATC_STR_ANG_P", label: "Steering Angle P", min: 0, max: 10, step: 0.1 },
  { param: "CRUISE_SPEED", label: "Cruise Speed (m/s)", min: 0, max: 30, step: 0.1 },
  { param: "CRUISE_THROTTLE", label: "Cruise Throttle (%)", min: 0, max: 100, step: 1 },
  { param: "WP_SPEED", label: "Waypoint Speed (m/s)", min: 0, max: 30, step: 0.1 },
  { param: "ATC_TURN_MAX_G", label: "Max Turn Accel (g)", min: 0.1, max: 5, step: 0.1 },
];

// ── Acro rate params (Copter and Plane name and scale them differently) ──

export const COPTER_ACRO_PARAMS: PidParam[] = [
  { param: "ACRO_RP_RATE", label: "ACRO Roll/Pitch Rate", min: 1, max: 1080, step: 1 },
  { param: "ACRO_Y_RATE", label: "ACRO Yaw Rate", min: 1, max: 360, step: 1 },
];

export const PLANE_ACRO_PARAMS: PidParam[] = [
  { param: "ACRO_ROLL_RATE", label: "ACRO Roll Rate", min: 10, max: 500, step: 1 },
  { param: "ACRO_PITCH_RATE", label: "ACRO Pitch Rate", min: 10, max: 500, step: 1 },
  { param: "ACRO_YAW_RATE", label: "ACRO Yaw Rate", min: 0, max: 500, step: 1 },
];

// ── Filter params (INS_*) ────────────────────────────────────

export const FILTER_PARAMS: PidParam[] = [
  { param: "INS_GYRO_FILTER", label: "Gyro LPF (Hz)", min: 0, max: 256, step: 1 },
  { param: "INS_ACCEL_FILTER", label: "Accel LPF (Hz)", min: 0, max: 256, step: 1 },
  { param: "INS_HNTCH_ENABLE", label: "Notch Enable", min: 0, max: 1, step: 1 },
  { param: "INS_HNTCH_FREQ", label: "Notch Freq (Hz)", min: 10, max: 400, step: 1 },
  { param: "INS_HNTCH_BW", label: "Notch BW (Hz)", min: 5, max: 200, step: 1 },
  { param: "INS_HNTCH_ATT", label: "Notch Attenuation (dB)", min: 0, max: 50, step: 1 },
  { param: "INS_HNTCH_REF", label: "Notch Reference", min: 0, max: 1, step: 0.01 },
  { param: "INS_HNTCH_MODE", label: "Notch Mode", min: 0, max: 5, step: 1 },
];

// ── PID preset profiles ──────────────────────────────────────

export interface PidPreset {
  name: string;
  description: string;
  values: Record<string, number>;
}

export const COPTER_PRESETS: PidPreset[] = [
  {
    name: "Conservative",
    description: "Gentle response, good for first flights",
    values: {
      ATC_RAT_RLL_P: 0.05, ATC_RAT_RLL_I: 0.05, ATC_RAT_RLL_D: 0.002,
      ATC_RAT_PIT_P: 0.05, ATC_RAT_PIT_I: 0.05, ATC_RAT_PIT_D: 0.002,
      ATC_RAT_YAW_P: 0.15, ATC_RAT_YAW_I: 0.015, ATC_RAT_YAW_D: 0.0,
    },
  },
  {
    name: "Default",
    description: "ArduCopter defaults — balanced response",
    values: {
      ATC_RAT_RLL_P: 0.135, ATC_RAT_RLL_I: 0.135, ATC_RAT_RLL_D: 0.004,
      ATC_RAT_PIT_P: 0.135, ATC_RAT_PIT_I: 0.135, ATC_RAT_PIT_D: 0.004,
      ATC_RAT_YAW_P: 0.18, ATC_RAT_YAW_I: 0.018, ATC_RAT_YAW_D: 0.0,
    },
  },
  {
    name: "Aggressive",
    description: "Snappy response — experienced pilots only",
    values: {
      ATC_RAT_RLL_P: 0.25, ATC_RAT_RLL_I: 0.25, ATC_RAT_RLL_D: 0.008,
      ATC_RAT_PIT_P: 0.25, ATC_RAT_PIT_I: 0.25, ATC_RAT_PIT_D: 0.008,
      ATC_RAT_YAW_P: 0.3, ATC_RAT_YAW_I: 0.03, ATC_RAT_YAW_D: 0.0,
    },
  },
];
