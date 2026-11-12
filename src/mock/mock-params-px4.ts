/**
 * PX4 mock parameter set for demo mode (the ArduPilot sets are in
 * `mock-params`).
 *
 * @license GPL-3.0-only
 */

import type { MockParam } from "./mock-params";

/**
 * PX4 parameters for demo mode.
 *
 * PX4-native parameter names with realistic defaults covering
 * PID, receiver, flight modes, power, failsafe, geofence, and navigation.
 */
export const PX4_MOCK_PARAMS: MockParam[] = [
  // ── Thermal calibration (TC_*) ────────────────────────
  { name: "TC_A_ENABLE", value: 1, type: 9 },
  { name: "TC_G_ENABLE", value: 1, type: 9 },
  { name: "TC_B_ENABLE", value: 0, type: 9 },
  { name: "SYS_CAL_ACCEL", value: 0, type: 9 },
  { name: "SYS_CAL_GYRO", value: 0, type: 9 },
  { name: "SYS_CAL_BARO", value: 0, type: 9 },
  { name: "SYS_CAL_TDEL", value: 24, type: 9 },
  { name: "SYS_CAL_TMIN", value: 5, type: 9 },
  { name: "SYS_CAL_TMAX", value: 10, type: 9 },
  { name: "TC_A0_ID", value: 1310988, type: 9 },
  { name: "TC_A0_TMIN", value: 5, type: 9 },
  { name: "TC_A0_TMAX", value: 55, type: 9 },
  { name: "TC_A0_TREF", value: 25, type: 9 },
  { name: "TC_G0_ID", value: 1310988, type: 9 },
  { name: "TC_G0_TMIN", value: 5, type: 9 },
  { name: "TC_G0_TMAX", value: 55, type: 9 },
  { name: "TC_G0_TREF", value: 25, type: 9 },

  // ── PID rate (inner loop) ─────────────────────────────
  { name: "MC_ROLLRATE_P", value: 0.15, type: 9 },
  { name: "MC_ROLLRATE_I", value: 0.2, type: 9 },
  { name: "MC_ROLLRATE_D", value: 0.003, type: 9 },
  { name: "MC_ROLLRATE_FF", value: 0, type: 9 },
  { name: "MC_PITCHRATE_P", value: 0.15, type: 9 },
  { name: "MC_PITCHRATE_I", value: 0.2, type: 9 },
  { name: "MC_PITCHRATE_D", value: 0.003, type: 9 },
  { name: "MC_PITCHRATE_FF", value: 0, type: 9 },
  { name: "MC_YAWRATE_P", value: 0.2, type: 9 },
  { name: "MC_YAWRATE_I", value: 0.1, type: 9 },
  { name: "MC_YAWRATE_D", value: 0, type: 9 },
  { name: "MC_YAWRATE_FF", value: 0, type: 9 },

  // ── PID angle (outer loop) ────────────────────────────
  { name: "MC_ROLL_P", value: 6.5, type: 9 },
  { name: "MC_PITCH_P", value: 6.5, type: 9 },
  { name: "MC_YAW_P", value: 2.8, type: 9 },

  // ── Receiver channel mapping ──────────────────────────
  { name: "RC_MAP_ROLL", value: 1, type: 9 },
  { name: "RC_MAP_PITCH", value: 2, type: 9 },
  { name: "RC_MAP_YAW", value: 4, type: 9 },
  { name: "RC_MAP_THROTTLE", value: 3, type: 9 },
  { name: "RC_MAP_FLTMODE", value: 5, type: 9 },

  // ── RC channels (PX4: RCn_REV is 1 normal / -1 reversed, no deadzone) ─
  ...Array.from({ length: 16 }, (_, i): MockParam[] => {
    const n = i + 1;
    return [
      { name: `RC${n}_MIN`, value: 1100, type: 9 },
      { name: `RC${n}_MAX`, value: 1900, type: 9 },
      { name: `RC${n}_TRIM`, value: n === 3 ? 1100 : 1500, type: 9 },
      { name: `RC${n}_REV`, value: 1, type: 9 },
    ];
  }).flat(),

  // ── Flight modes ──────────────────────────────────────
  { name: "COM_FLTMODE1", value: 0, type: 9 },
  { name: "COM_FLTMODE2", value: 1, type: 9 },
  { name: "COM_FLTMODE3", value: 2, type: 9 },
  { name: "COM_FLTMODE4", value: 3, type: 9 },
  { name: "COM_FLTMODE5", value: 4, type: 9 },
  { name: "COM_FLTMODE6", value: 5, type: 9 },

  // ── Power / battery ───────────────────────────────────
  { name: "BAT1_SOURCE", value: 0, type: 9 },
  { name: "BAT1_CAPACITY", value: 3300, type: 9 },
  { name: "BAT1_V_DIV", value: 18.1, type: 9 },
  { name: "BAT1_A_PER_V", value: 24.0, type: 9 },
  { name: "BAT_V_OFFS_CURR", value: 0, type: 9 },
  { name: "BAT_N_CELLS", value: 4, type: 9 },
  { name: "BAT_V_EMPTY", value: 3.5, type: 9 },
  { name: "BAT_V_CHARGED", value: 4.2, type: 9 },

  // ── Failsafe ──────────────────────────────────────────
  { name: "COM_RC_LOSS_T", value: 0.5, type: 9 },
  { name: "RC_FAILS_THR", value: 950, type: 9 },
  { name: "COM_DL_LOSS_T", value: 10, type: 9 },
  { name: "COM_LOW_BAT_ACT", value: 0, type: 9 },
  { name: "BAT_LOW_THR", value: 0.15, type: 9 },
  { name: "BAT_CRIT_THR", value: 0.07, type: 9 },
  { name: "BAT_EMERGEN_THR", value: 0.05, type: 9 },

  // ── Geofence ──────────────────────────────────────────
  { name: "GF_ACTION", value: 1, type: 9 },
  { name: "GF_MAX_VER_DIST", value: 120, type: 9 },
  { name: "GF_MAX_HOR_DIST", value: 500, type: 9 },

  // ── Navigation ────────────────────────────────────────
  { name: "MPC_XY_VEL_MAX", value: 12, type: 9 },
  { name: "MPC_Z_VEL_MAX_UP", value: 3, type: 9 },
  { name: "MPC_Z_VEL_MAX_DN", value: 1, type: 9 },
  { name: "MPC_ACC_HOR", value: 3, type: 9 },
  { name: "MPC_ACC_UP_MAX", value: 4, type: 9 },
  { name: "MPC_LAND_SPEED", value: 0.7, type: 9 },
  { name: "RTL_RETURN_ALT", value: 30, type: 9 },
  { name: "RTL_TYPE", value: 0, type: 9 },

  // ── General ───────────────────────────────────────────
  { name: "COM_ARM_CHK_MODE", value: 1, type: 9 },
  { name: "COM_ARM_AUTH_REQ", value: 0, type: 9 },
  { name: "SYS_AUTOSTART", value: 4001, type: 9 },

  // ── PX4-only PID gain multipliers ──────────────────────────
  { name: "MC_ROLLRATE_K", value: 1.0, type: 9 },
  { name: "MC_PITCHRATE_K", value: 1.0, type: 9 },
  { name: "MC_YAWRATE_K", value: 1.0, type: 9 },

  // ── PX4 battery extras ─────────────────────────────────────
  { name: "BAT1_N_CELLS", value: 4, type: 9 },
  { name: "BAT1_R_INTERNAL", value: 0.005, type: 9 },

  // ── Sensors / rangefinder ──────────────────────────────────
  { name: "SENS_EN_MB12XX", value: 0, type: 9 },
  { name: "SENS_EN_LL40LS", value: 0, type: 9 },
  { name: "SENS_EN_SF1XX", value: 0, type: 9 },
  { name: "EKF2_RNG_AID", value: 1, type: 9 },
  { name: "EKF2_RNG_A_HMAX", value: 5, type: 9 },
  { name: "EKF2_RNG_NOISE", value: 0.05, type: 9 },
  { name: "EKF2_RNG_SFE", value: 0.05, type: 9 },
  { name: "EKF2_MIN_RNG", value: 0.1, type: 9 },

  // ── Gimbal (PX4 mount params) ──────────────────────────────
  { name: "MNT_MODE_IN", value: 0, type: 9 },
  { name: "MNT_MAN_PITCH", value: 0, type: 9 },
  { name: "MNT_MAN_ROLL", value: 0, type: 9 },
  { name: "MNT_MAN_YAW", value: 0, type: 9 },
  { name: "MNT_RATE_PITCH", value: 90, type: 9 },
  { name: "MNT_RATE_YAW", value: 90, type: 9 },

  // ── Camera (PX4 trigger params) ────────────────────────────
  { name: "TRIG_MODE", value: 0, type: 9 },
  { name: "TRIG_ACT_TIME", value: 40, type: 9 },
  { name: "TRIG_DISTANCE", value: 25, type: 9 },
  { name: "TRIG_PWM_SHOOT", value: 1900, type: 9 },

  // ── EKF failsafe (PX4-only) ────────────────────────────────
  { name: "COM_POS_FS_EPH", value: 5, type: 9 },
  { name: "COM_VEL_FS_EVH", value: 1, type: 9 },

  // ── Geofence extras ────────────────────────────────────────
  { name: "GF_ALTMODE", value: 0, type: 9 },
  { name: "GF_SOURCE", value: 0, type: 9 },

  // ── Serial ports ───────────────────────────────────────────
  { name: "SER_TEL1_BAUD", value: 57600, type: 9 },
  { name: "SER_TEL2_BAUD", value: 921600, type: 9 },
  { name: "SER_TEL3_BAUD", value: 57600, type: 9 },
  { name: "SER_GPS1_BAUD", value: 0, type: 9 },

  // ── Airframe / actuator ────────────────────────────────────
  { name: "SYS_AUTOCONFIG", value: 0, type: 9 },
  { name: "CA_AIRFRAME", value: 0, type: 9 },
  { name: "CA_METHOD", value: 2, type: 9 },
  { name: "CA_R_REV", value: 0, type: 9 },
  { name: "CA_ROTOR_COUNT", value: 4, type: 9 },
  { name: "CA_ROTOR0_PX", value: 0.15, type: 9 },
  { name: "CA_ROTOR0_PY", value: 0.15, type: 9 },
  { name: "CA_ROTOR0_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR1_PX", value: -0.15, type: 9 },
  { name: "CA_ROTOR1_PY", value: -0.15, type: 9 },
  { name: "CA_ROTOR1_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR2_PX", value: 0.15, type: 9 },
  { name: "CA_ROTOR2_PY", value: -0.15, type: 9 },
  { name: "CA_ROTOR2_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR3_PX", value: -0.15, type: 9 },
  { name: "CA_ROTOR3_PY", value: 0.15, type: 9 },
  { name: "CA_ROTOR3_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR4_PX", value: 0.22, type: 9 },
  { name: "CA_ROTOR4_PY", value: 0, type: 9 },
  { name: "CA_ROTOR4_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR5_PX", value: -0.22, type: 9 },
  { name: "CA_ROTOR5_PY", value: 0, type: 9 },
  { name: "CA_ROTOR5_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR6_PX", value: 0, type: 9 },
  { name: "CA_ROTOR6_PY", value: 0.22, type: 9 },
  { name: "CA_ROTOR6_PZ", value: 0, type: 9 },
  { name: "CA_ROTOR7_PX", value: 0, type: 9 },
  { name: "CA_ROTOR7_PY", value: -0.22, type: 9 },
  { name: "CA_ROTOR7_PZ", value: 0, type: 9 },
  { name: "PWM_MAIN_FUNC1", value: 101, type: 9 },
  { name: "PWM_MAIN_FUNC2", value: 102, type: 9 },
  { name: "PWM_MAIN_FUNC3", value: 103, type: 9 },
  { name: "PWM_MAIN_FUNC4", value: 104, type: 9 },
  { name: "PWM_MAIN_FUNC5", value: 0, type: 9 },
  { name: "PWM_MAIN_FUNC6", value: 0, type: 9 },
  { name: "PWM_MAIN_FUNC7", value: 0, type: 9 },
  { name: "PWM_MAIN_FUNC8", value: 0, type: 9 },
  // Per-rotor aero coefficients (thrust/moment/axis/tilt/slew) for the 4 active rotors.
  { name: "CA_ROTOR0_CT", value: 6.5, type: 9 }, { name: "CA_ROTOR0_KM", value: 0.05, type: 9 }, { name: "CA_ROTOR0_AX", value: 0, type: 9 }, { name: "CA_ROTOR0_AY", value: 0, type: 9 }, { name: "CA_ROTOR0_AZ", value: -1, type: 9 }, { name: "CA_ROTOR0_TILT", value: 0, type: 9 }, { name: "CA_R0_SLEW", value: 0, type: 9 },
  { name: "CA_ROTOR1_CT", value: 6.5, type: 9 }, { name: "CA_ROTOR1_KM", value: 0.05, type: 9 }, { name: "CA_ROTOR1_AX", value: 0, type: 9 }, { name: "CA_ROTOR1_AY", value: 0, type: 9 }, { name: "CA_ROTOR1_AZ", value: -1, type: 9 }, { name: "CA_ROTOR1_TILT", value: 0, type: 9 }, { name: "CA_R1_SLEW", value: 0, type: 9 },
  { name: "CA_ROTOR2_CT", value: 6.5, type: 9 }, { name: "CA_ROTOR2_KM", value: -0.05, type: 9 }, { name: "CA_ROTOR2_AX", value: 0, type: 9 }, { name: "CA_ROTOR2_AY", value: 0, type: 9 }, { name: "CA_ROTOR2_AZ", value: -1, type: 9 }, { name: "CA_ROTOR2_TILT", value: 0, type: 9 }, { name: "CA_R2_SLEW", value: 0, type: 9 },
  { name: "CA_ROTOR3_CT", value: 6.5, type: 9 }, { name: "CA_ROTOR3_KM", value: -0.05, type: 9 }, { name: "CA_ROTOR3_AX", value: 0, type: 9 }, { name: "CA_ROTOR3_AY", value: 0, type: 9 }, { name: "CA_ROTOR3_AZ", value: -1, type: 9 }, { name: "CA_ROTOR3_TILT", value: 0, type: 9 }, { name: "CA_R3_SLEW", value: 0, type: 9 },
  // Two control surfaces + one tilt servo, so those sections render in demo.
  { name: "CA_SV_CS_COUNT", value: 2, type: 9 },
  { name: "CA_SV_CS0_TYPE", value: 1, type: 9 }, { name: "CA_SV_CS0_TRQ_R", value: 0.5, type: 9 }, { name: "CA_SV_CS0_TRQ_P", value: 0, type: 9 }, { name: "CA_SV_CS0_TRQ_Y", value: 0, type: 9 }, { name: "CA_SV_CS0_TRIM", value: 0, type: 9 },
  { name: "CA_SV_CS1_TYPE", value: 2, type: 9 }, { name: "CA_SV_CS1_TRQ_R", value: -0.5, type: 9 }, { name: "CA_SV_CS1_TRQ_P", value: 0, type: 9 }, { name: "CA_SV_CS1_TRQ_Y", value: 0, type: 9 }, { name: "CA_SV_CS1_TRIM", value: 0, type: 9 },
  { name: "CA_SV_TL_COUNT", value: 1, type: 9 },
  { name: "CA_SV_TL0_CT", value: 1, type: 9 }, { name: "CA_SV_TL0_MINA", value: 0, type: 9 }, { name: "CA_SV_TL0_MAXA", value: 90, type: 9 }, { name: "CA_SV_TL0_TD", value: 0, type: 9 },
];

/** PX4 standard VTOL: the multicopter set plus the VT_* transition group, so
 * the VTOL Transition panel reads real values in demo. */
export const PX4_VTOL_MOCK_PARAMS: MockParam[] = [
  ...PX4_MOCK_PARAMS,
  { name: "VT_TYPE", value: 2, type: 9 }, // standard VTOL
  { name: "VT_FWD_THRUST_EN", value: 0, type: 9 },
  { name: "VT_FWD_THRUST_SC", value: 0.7, type: 9 },
  { name: "VT_ARSP_TRANS", value: 17, type: 9 },
  { name: "VT_ARSP_BLEND", value: 12, type: 9 },
  { name: "VT_F_TRANS_DUR", value: 5, type: 9 },
  { name: "VT_F_TRANS_THR", value: 1, type: 9 },
  { name: "VT_B_TRANS_DUR", value: 4, type: 9 },
  { name: "VT_B_TRANS_RAMP", value: 3, type: 9 },
  { name: "VT_TRANS_MIN_TM", value: 2, type: 9 },
  { name: "VT_TRANS_TIMEOUT", value: 15, type: 9 },
  { name: "VT_FW_MIN_ALT", value: 0, type: 9 },
  { name: "VT_QC_ALT_LOSS", value: 0, type: 9 },
  { name: "VT_FW_QC_P", value: 0, type: 9 },
  { name: "VT_FW_QC_R", value: 0, type: 9 },
  { name: "VT_PSHER_SLEW", value: 0.33, type: 9 },
];
