// Exempt from 300 LOC soft rule: pure mock parameter fixture for demo mode
/**
 * Default ArduCopter parameters for demo mode.
 *
 * ~200 realistic parameters covering all Configure tab panels:
 * Parameters, Outputs, Receiver, Flight Modes, Failsafe, Power,
 * Calibration, PID Tuning, Ports.
 *
 * All type: 9 (MAV_PARAM_TYPE_REAL32).
 *
 * @license GPL-3.0-only
 */

export interface MockParam {
  name: string;
  value: number;
  type: number;
}

export const MOCK_PARAMS: MockParam[] = [
  // ── PID: Roll / Pitch / Yaw ──────────────────────────
  { name: "ATC_RAT_RLL_P", value: 0.135, type: 9 },
  { name: "ATC_RAT_RLL_I", value: 0.135, type: 9 },
  { name: "ATC_RAT_RLL_D", value: 0.0036, type: 9 },
  { name: "ATC_RAT_RLL_FF", value: 0, type: 9 },
  { name: "ATC_RAT_PIT_P", value: 0.135, type: 9 },
  { name: "ATC_RAT_PIT_I", value: 0.135, type: 9 },
  { name: "ATC_RAT_PIT_D", value: 0.0036, type: 9 },
  { name: "ATC_RAT_PIT_FF", value: 0, type: 9 },
  { name: "ATC_RAT_YAW_P", value: 0.18, type: 9 },
  { name: "ATC_RAT_YAW_I", value: 0.018, type: 9 },
  { name: "ATC_RAT_YAW_D", value: 0, type: 9 },
  { name: "ATC_RAT_YAW_FF", value: 0, type: 9 },
  { name: "ATC_ANG_RLL_P", value: 4.5, type: 9 },
  { name: "ATC_ANG_PIT_P", value: 4.5, type: 9 },
  { name: "ATC_ANG_YAW_P", value: 4.5, type: 9 },

  // ── Rover tuning (steering-rate / speed PIDs + navigation) ──
  { name: "ATC_STR_RAT_P", value: 0.2, type: 9 },
  { name: "ATC_STR_RAT_I", value: 0.2, type: 9 },
  { name: "ATC_STR_RAT_D", value: 0, type: 9 },
  { name: "ATC_STR_RAT_FF", value: 0.2, type: 9 },
  { name: "ATC_STR_RAT_FLTT", value: 10, type: 9 },
  { name: "ATC_STR_RAT_FLTD", value: 10, type: 9 },
  { name: "ATC_SPEED_P", value: 0.2, type: 9 },
  { name: "ATC_SPEED_I", value: 0.2, type: 9 },
  { name: "ATC_SPEED_D", value: 0, type: 9 },
  { name: "ATC_SPEED_FF", value: 0, type: 9 },
  { name: "ATC_SPEED_FLTT", value: 10, type: 9 },
  { name: "ATC_SPEED_FLTD", value: 10, type: 9 },
  { name: "ATC_STR_ANG_P", value: 3, type: 9 },
  { name: "CRUISE_SPEED", value: 2, type: 9 },
  { name: "CRUISE_THROTTLE", value: 50, type: 9 },
  { name: "WP_SPEED", value: 2, type: 9 },
  { name: "ATC_TURN_MAX_G", value: 0.6, type: 9 },
  // ArduPlane rate-controller gains (post-4.1 names) for the PID panel's Plane tab.
  { name: "RLL_RATE_P", value: 0.08, type: 9 },
  { name: "RLL_RATE_I", value: 0.15, type: 9 },
  { name: "RLL_RATE_D", value: 0, type: 9 },
  { name: "RLL_RATE_IMAX", value: 3000, type: 9 },
  { name: "RLL_RATE_FF", value: 0.5, type: 9 },
  { name: "PTCH_RATE_P", value: 0.08, type: 9 },
  { name: "PTCH_RATE_I", value: 0.15, type: 9 },
  { name: "PTCH_RATE_D", value: 0, type: 9 },
  { name: "PTCH_RATE_IMAX", value: 3000, type: 9 },
  { name: "PTCH_RATE_FF", value: 0.5, type: 9 },
  { name: "YAW2SRV_SLIP", value: 0, type: 9 },
  { name: "YAW2SRV_INT", value: 0, type: 9 },
  { name: "YAW2SRV_DAMP", value: 0, type: 9 },
  { name: "YAW2SRV_RLL", value: 1, type: 9 },

  // ── EKF3 estimator (general + source sets + noise) ──
  { name: "AHRS_EKF_TYPE", value: 3, type: 9 },
  { name: "EK3_ENABLE", value: 1, type: 9 },
  { name: "EK3_IMU_MASK", value: 3, type: 9 },
  { name: "EK3_PRIMARY", value: 0, type: 9 },
  { name: "EK3_SRC1_POSXY", value: 3, type: 9 },
  { name: "EK3_SRC1_VELXY", value: 3, type: 9 },
  { name: "EK3_SRC1_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC1_VELZ", value: 0, type: 9 },
  { name: "EK3_SRC1_YAW", value: 1, type: 9 },
  { name: "EK3_SRC2_POSXY", value: 0, type: 9 },
  { name: "EK3_SRC2_VELXY", value: 0, type: 9 },
  { name: "EK3_SRC2_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC2_VELZ", value: 0, type: 9 },
  { name: "EK3_SRC2_YAW", value: 0, type: 9 },
  { name: "EK3_SRC3_POSXY", value: 0, type: 9 },
  { name: "EK3_SRC3_VELXY", value: 0, type: 9 },
  { name: "EK3_SRC3_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC3_VELZ", value: 0, type: 9 },
  { name: "EK3_SRC3_YAW", value: 0, type: 9 },
  { name: "EK3_SRC_OPTIONS", value: 0, type: 9 },
  { name: "EK3_POSNE_M_NSE", value: 0.5, type: 9 },
  { name: "EK3_ALT_M_NSE", value: 2.0, type: 9 },
  { name: "EK3_VELNE_M_NSE", value: 0.3, type: 9 },
  { name: "EK3_VELD_M_NSE", value: 0.5, type: 9 },
  { name: "EK3_MAG_M_NSE", value: 0.05, type: 9 },

  // ── Telemetry stream rates (per MAVLink channel MAVn_*) ──
  { name: "MAV1_RAW_SENS", value: 2, type: 9 },
  { name: "MAV1_EXT_STAT", value: 2, type: 9 },
  { name: "MAV1_RC_CHAN", value: 2, type: 9 },
  { name: "MAV1_RAW_CTRL", value: 0, type: 9 },
  { name: "MAV1_POSITION", value: 2, type: 9 },
  { name: "MAV1_EXTRA1", value: 4, type: 9 },
  { name: "MAV1_EXTRA2", value: 4, type: 9 },
  { name: "MAV1_EXTRA3", value: 2, type: 9 },
  { name: "MAV1_PARAMS", value: 10, type: 9 },
  { name: "MAV1_ADSB", value: 0, type: 9 },
  { name: "MAV2_RAW_SENS", value: 1, type: 9 },
  { name: "MAV2_EXT_STAT", value: 1, type: 9 },
  { name: "MAV2_RC_CHAN", value: 1, type: 9 },
  { name: "MAV2_RAW_CTRL", value: 0, type: 9 },
  { name: "MAV2_POSITION", value: 1, type: 9 },
  { name: "MAV2_EXTRA1", value: 2, type: 9 },
  { name: "MAV2_EXTRA2", value: 2, type: 9 },
  { name: "MAV2_EXTRA3", value: 1, type: 9 },
  { name: "MAV2_PARAMS", value: 10, type: 9 },
  { name: "MAV2_ADSB", value: 0, type: 9 },

  // ── QuadPlane / VTOL (Q_*) ────────────────────────────
  { name: "Q_ENABLE", value: 1, type: 9 },
  { name: "Q_FRAME_CLASS", value: 1, type: 9 },
  { name: "Q_FRAME_TYPE", value: 1, type: 9 },
  { name: "Q_TRANSITION_MS", value: 5000, type: 9 },
  { name: "Q_TRANS_DECEL", value: 2, type: 9 },
  { name: "Q_ASSIST_SPEED", value: 8, type: 9 },
  { name: "Q_ASSIST_ANGLE", value: 30, type: 9 },
  { name: "Q_ASSIST_ALT", value: 0, type: 9 },
  { name: "Q_TILT_MASK", value: 0, type: 9 },
  { name: "Q_TILT_TYPE", value: 0, type: 9 },
  { name: "Q_TILT_MAX", value: 45, type: 9 },
  { name: "Q_TILT_RATE_UP", value: 40, type: 9 },
  { name: "Q_TILT_RATE_DN", value: 0, type: 9 },
  { name: "Q_TAILSIT_ENABLE", value: 0, type: 9 },
  { name: "Q_TAILSIT_ANGLE", value: 45, type: 9 },
  { name: "Q_TAILSIT_INPUT", value: 0, type: 9 },
  { name: "Q_TAILSIT_MOTMX", value: 0, type: 9 },

  // ── TECS energy control + L1 navigation (fixed-wing) ──
  { name: "TECS_CLMB_MAX", value: 5, type: 9 },
  { name: "TECS_SINK_MIN", value: 2, type: 9 },
  { name: "TECS_SINK_MAX", value: 5, type: 9 },
  { name: "TECS_TIME_CONST", value: 5, type: 9 },
  { name: "TECS_THR_DAMP", value: 0.5, type: 9 },
  { name: "TECS_INTEG_GAIN", value: 0.3, type: 9 },
  { name: "TECS_SPDWEIGHT", value: 1, type: 9 },
  { name: "TECS_PTCH_DAMP", value: 0.3, type: 9 },
  { name: "TECS_RLL2THR", value: 10, type: 9 },
  { name: "NAVL1_PERIOD", value: 20, type: 9 },
  { name: "NAVL1_DAMPING", value: 0.75, type: 9 },
  { name: "NAVL1_XTRACK_I", value: 0.02, type: 9 },
  { name: "NAVL1_LIM_BANK", value: 0, type: 9 },

  // ── ArduSub depth hold, failsafes, joystick buttons ──
  { name: "PSC_POSZ_P", value: 3, type: 9 },
  { name: "PSC_VELZ_P", value: 5, type: 9 },
  { name: "PSC_VELZ_I", value: 0.5, type: 9 },
  { name: "PSC_ACCZ_P", value: 0.5, type: 9 },
  { name: "PSC_ACCZ_I", value: 1, type: 9 },
  { name: "PSC_ACCZ_D", value: 0, type: 9 },
  { name: "SURFACE_DEPTH", value: -10, type: 9 },
  { name: "PSC_POSXY_P", value: 1, type: 9 },
  { name: "PSC_VELXY_P", value: 2, type: 9 },
  { name: "PSC_VELXY_I", value: 0.5, type: 9 },
  { name: "PSC_VELXY_D", value: 0, type: 9 },
  { name: "FS_LEAK_ENABLE", value: 1, type: 9 },
  { name: "FS_PRESS_ENABLE", value: 0, type: 9 },
  { name: "FS_PRESS_MAX", value: 2000000, type: 9 },
  { name: "FS_TEMP_ENABLE", value: 0, type: 9 },
  { name: "FS_TEMP_MAX", value: 62, type: 9 },
  ...Array.from({ length: 16 }, (_, i) => ({ name: `BTN${i}_FUNCTION`, value: i === 0 ? 3 : 0, type: 9 })),
  ...Array.from({ length: 16 }, (_, i) => ({ name: `BTN${i}_SFUNCTION`, value: 0, type: 9 })),

  // ── PX4 flight behavior (MPC position/velocity/accel/jerk/tilt) ──
  { name: "MPC_XY_CRUISE", value: 5, type: 9 },
  { name: "MPC_XY_VEL_MAX", value: 12, type: 9 },
  { name: "MPC_Z_VEL_MAX_UP", value: 3, type: 9 },
  { name: "MPC_Z_VEL_MAX_DN", value: 1.5, type: 9 },
  { name: "MPC_ACC_HOR", value: 3, type: 9 },
  { name: "MPC_ACC_HOR_MAX", value: 5, type: 9 },
  { name: "MPC_ACC_UP_MAX", value: 4, type: 9 },
  { name: "MPC_ACC_DOWN_MAX", value: 3, type: 9 },
  { name: "MPC_JERK_AUTO", value: 4, type: 9 },
  { name: "MPC_JERK_MAX", value: 8, type: 9 },
  { name: "MPC_TILTMAX_AIR", value: 45, type: 9 },
  { name: "MPC_TILTMAX_LND", value: 12, type: 9 },
  { name: "MPC_XY_P", value: 0.95, type: 9 },
  { name: "MPC_Z_P", value: 1, type: 9 },
  { name: "MPC_XY_VEL_P_ACC", value: 1.8, type: 9 },
  { name: "MPC_XY_VEL_I_ACC", value: 0.4, type: 9 },
  { name: "MPC_XY_VEL_D_ACC", value: 0.2, type: 9 },
  { name: "MPC_Z_VEL_P_ACC", value: 4, type: 9 },
  { name: "MPC_Z_VEL_I_ACC", value: 2, type: 9 },
  { name: "MPC_Z_VEL_D_ACC", value: 0, type: 9 },

  // ── PX4 fixed-wing rate PIDs + TECS ───────────────────
  { name: "FW_RR_P", value: 0.05, type: 9 },
  { name: "FW_RR_I", value: 0.1, type: 9 },
  { name: "FW_RR_D", value: 0, type: 9 },
  { name: "FW_RR_FF", value: 0.5, type: 9 },
  { name: "FW_RR_IMAX", value: 0.2, type: 9 },
  { name: "FW_PR_P", value: 0.08, type: 9 },
  { name: "FW_PR_I", value: 0.1, type: 9 },
  { name: "FW_PR_D", value: 0, type: 9 },
  { name: "FW_PR_FF", value: 0.5, type: 9 },
  { name: "FW_PR_IMAX", value: 0.4, type: 9 },
  { name: "FW_YR_P", value: 0.05, type: 9 },
  { name: "FW_YR_I", value: 0.1, type: 9 },
  { name: "FW_YR_D", value: 0, type: 9 },
  { name: "FW_YR_FF", value: 0.3, type: 9 },
  { name: "FW_YR_IMAX", value: 0.2, type: 9 },
  { name: "FW_T_CLMB_MAX", value: 5, type: 9 },
  { name: "FW_T_SINK_MAX", value: 5, type: 9 },
  { name: "FW_T_SINK_MIN", value: 2, type: 9 },
  { name: "FW_T_SPDWEIGHT", value: 1, type: 9 },
  { name: "FW_T_THR_DAMPING", value: 0.05, type: 9 },
  { name: "FW_T_THR_INTEG", value: 0.02, type: 9 },
  { name: "FW_T_PTCH_DAMP", value: 0.1, type: 9 },
  { name: "FW_T_I_GAIN_PIT", value: 0.1, type: 9 },
  { name: "FW_T_RLL2THR", value: 15, type: 9 },
  { name: "FW_T_HRATE_FF", value: 0.3, type: 9 },
  { name: "FW_T_VERT_ACC", value: 7, type: 9 },
  { name: "FW_PSP_OFF", value: 0, type: 9 },

  // ── PX4 autotune (MC + FW) ────────────────────────────
  { name: "MC_AT_EN", value: 0, type: 9 },
  { name: "MC_AT_START", value: 0, type: 9 },
  { name: "MC_AT_APPLY", value: 1, type: 9 },
  { name: "MC_AT_RISE_TIME", value: 0.14, type: 9 },
  { name: "MC_AT_SYSID_AMP", value: 0.7, type: 9 },
  { name: "FW_AT_START", value: 0, type: 9 },
  { name: "FW_AT_APPLY", value: 2, type: 9 },
  { name: "FW_AT_AXES", value: 3, type: 9 },
  { name: "FW_AT_MAN_AUX", value: 0, type: 9 },
  { name: "FW_AT_SYSID_AMP", value: 1, type: 9 },
  { name: "FW_AT_SYSID_F0", value: 1, type: 9 },
  { name: "FW_AT_SYSID_F1", value: 20, type: 9 },
  { name: "FW_AT_SYSID_TIME", value: 10, type: 9 },
  { name: "FW_AT_SYSID_TYPE", value: 0, type: 9 },

  // ── PX4 VTOL transition (VT_*) ────────────────────────
  { name: "VT_TYPE", value: 2, type: 9 },
  { name: "VT_F_TRANS_DUR", value: 5, type: 9 },
  { name: "VT_B_TRANS_DUR", value: 10, type: 9 },
  { name: "VT_F_TRANS_THR", value: 1, type: 9 },
  { name: "VT_ARSP_BLEND", value: 8, type: 9 },
  { name: "VT_ARSP_TRANS", value: 10, type: 9 },
  { name: "VT_TRANS_TIMEOUT", value: 15, type: 9 },
  { name: "VT_TRANS_MIN_TM", value: 2, type: 9 },
  { name: "VT_FW_MIN_ALT", value: 0, type: 9 },
  { name: "VT_FW_QC_P", value: 0, type: 9 },
  { name: "VT_FW_QC_R", value: 0, type: 9 },
  { name: "VT_QC_ALT_LOSS", value: 0, type: 9 },
  { name: "VT_TILT_MC", value: 0, type: 9 },
  { name: "VT_TILT_TRANS", value: 0.4, type: 9 },
  { name: "VT_TILT_FW", value: 1, type: 9 },
  { name: "VT_TRANS_P2_DUR", value: 0.5, type: 9 },
  { name: "VT_BT_TILT_DUR", value: 1, type: 9 },
  { name: "VT_FWD_THRUST_EN", value: 0, type: 9 },
  { name: "VT_FWD_THRUST_SC", value: 0.7, type: 9 },
  { name: "VT_B_TRANS_RAMP", value: 3, type: 9 },
  { name: "VT_PSHER_SLEW", value: 0.33, type: 9 },

  // ── PX4 GPS driver config ─────────────────────────────
  { name: "GPS_1_PROTOCOL", value: 1, type: 9 },
  { name: "GPS_1_GNSS", value: 0, type: 9 },
  { name: "GPS_UBX_DYNMODEL", value: 7, type: 9 },
  { name: "GPS_UBX_MODE", value: 0, type: 9 },
  { name: "GPS_YAW_OFFSET", value: 0, type: 9 },
  { name: "GPS_SAT_INFO", value: 0, type: 9 },
  { name: "GPS_2_PROTOCOL", value: 1, type: 9 },
  { name: "GPS_2_GNSS", value: 0, type: 9 },

  // ── RC Channels ──────────────────────────────────────
  { name: "RC1_MIN", value: 1100, type: 9 },
  { name: "RC1_MAX", value: 1900, type: 9 },
  { name: "RC1_TRIM", value: 1500, type: 9 },
  { name: "RC1_REVERSED", value: 0, type: 9 },
  { name: "RC2_MIN", value: 1100, type: 9 },
  { name: "RC2_MAX", value: 1900, type: 9 },
  { name: "RC2_TRIM", value: 1500, type: 9 },
  { name: "RC2_REVERSED", value: 0, type: 9 },
  { name: "RC3_MIN", value: 1100, type: 9 },
  { name: "RC3_MAX", value: 1900, type: 9 },
  { name: "RC3_TRIM", value: 1100, type: 9 },
  { name: "RC3_REVERSED", value: 0, type: 9 },
  { name: "RC4_MIN", value: 1100, type: 9 },
  { name: "RC4_MAX", value: 1900, type: 9 },
  { name: "RC4_TRIM", value: 1500, type: 9 },
  { name: "RC4_REVERSED", value: 0, type: 9 },
  { name: "RC5_MIN", value: 1100, type: 9 },
  { name: "RC5_MAX", value: 1900, type: 9 },
  { name: "RC5_TRIM", value: 1500, type: 9 },
  { name: "RC5_REVERSED", value: 0, type: 9 },
  { name: "RC6_MIN", value: 1100, type: 9 },
  { name: "RC6_MAX", value: 1900, type: 9 },
  { name: "RC6_TRIM", value: 1500, type: 9 },
  { name: "RC6_REVERSED", value: 0, type: 9 },
  { name: "RC7_MIN", value: 1100, type: 9 },
  { name: "RC7_MAX", value: 1900, type: 9 },
  { name: "RC7_TRIM", value: 1500, type: 9 },
  { name: "RC7_REVERSED", value: 0, type: 9 },
  { name: "RC8_MIN", value: 1100, type: 9 },
  { name: "RC8_MAX", value: 1900, type: 9 },
  { name: "RC8_TRIM", value: 1500, type: 9 },
  { name: "RC8_REVERSED", value: 0, type: 9 },

  // ── RC Channels 9-16 ──────────────────────────────────────
  { name: "RC9_MIN", value: 1100, type: 9 },
  { name: "RC9_MAX", value: 1900, type: 9 },
  { name: "RC9_TRIM", value: 1500, type: 9 },
  { name: "RC9_REVERSED", value: 0, type: 9 },
  { name: "RC10_MIN", value: 1100, type: 9 },
  { name: "RC10_MAX", value: 1900, type: 9 },
  { name: "RC10_TRIM", value: 1500, type: 9 },
  { name: "RC10_REVERSED", value: 0, type: 9 },
  { name: "RC11_MIN", value: 1100, type: 9 },
  { name: "RC11_MAX", value: 1900, type: 9 },
  { name: "RC11_TRIM", value: 1500, type: 9 },
  { name: "RC11_REVERSED", value: 0, type: 9 },
  { name: "RC12_MIN", value: 1100, type: 9 },
  { name: "RC12_MAX", value: 1900, type: 9 },
  { name: "RC12_TRIM", value: 1500, type: 9 },
  { name: "RC12_REVERSED", value: 0, type: 9 },
  { name: "RC13_MIN", value: 1100, type: 9 },
  { name: "RC13_MAX", value: 1900, type: 9 },
  { name: "RC13_TRIM", value: 1500, type: 9 },
  { name: "RC13_REVERSED", value: 0, type: 9 },
  { name: "RC14_MIN", value: 1100, type: 9 },
  { name: "RC14_MAX", value: 1900, type: 9 },
  { name: "RC14_TRIM", value: 1500, type: 9 },
  { name: "RC14_REVERSED", value: 0, type: 9 },
  { name: "RC15_MIN", value: 1100, type: 9 },
  { name: "RC15_MAX", value: 1900, type: 9 },
  { name: "RC15_TRIM", value: 1500, type: 9 },
  { name: "RC15_REVERSED", value: 0, type: 9 },
  { name: "RC16_MIN", value: 1100, type: 9 },
  { name: "RC16_MAX", value: 1900, type: 9 },
  { name: "RC16_TRIM", value: 1500, type: 9 },
  { name: "RC16_REVERSED", value: 0, type: 9 },

  // ── RC Channel Mapping ─────────────────────────────────────
  { name: "RCMAP_ROLL", value: 1, type: 9 },
  { name: "RCMAP_PITCH", value: 2, type: 9 },
  { name: "RCMAP_THROTTLE", value: 3, type: 9 },
  { name: "RCMAP_YAW", value: 4, type: 9 },

  // ── GPS Antenna Offsets ───────────────────────────────────
  { name: "GPS_POS1_X", value: 0, type: 9 },
  { name: "GPS_POS1_Y", value: 0, type: 9 },
  { name: "GPS_POS1_Z", value: 0, type: 9 },

  // ── RC Per-Channel Deadzone ────────────────────────────────
  { name: "RC1_DZ", value: 30, type: 9 },
  { name: "RC2_DZ", value: 30, type: 9 },
  { name: "RC3_DZ", value: 30, type: 9 },
  { name: "RC4_DZ", value: 30, type: 9 },
  { name: "RC5_DZ", value: 0, type: 9 },
  { name: "RC6_DZ", value: 0, type: 9 },
  { name: "RC7_DZ", value: 0, type: 9 },
  { name: "RC8_DZ", value: 0, type: 9 },
  { name: "RC9_DZ", value: 0, type: 9 },
  { name: "RC10_DZ", value: 0, type: 9 },
  { name: "RC11_DZ", value: 0, type: 9 },
  { name: "RC12_DZ", value: 0, type: 9 },
  { name: "RC13_DZ", value: 0, type: 9 },
  { name: "RC14_DZ", value: 0, type: 9 },
  { name: "RC15_DZ", value: 0, type: 9 },
  { name: "RC16_DZ", value: 0, type: 9 },

  // ── RC Per-Channel Aux Option ──────────────────────────────
  { name: "RC1_OPTION", value: 0, type: 9 },
  { name: "RC2_OPTION", value: 0, type: 9 },
  { name: "RC3_OPTION", value: 0, type: 9 },
  { name: "RC4_OPTION", value: 0, type: 9 },
  { name: "RC5_OPTION", value: 0, type: 9 },
  { name: "RC6_OPTION", value: 7, type: 9 },   // Save WP
  { name: "RC7_OPTION", value: 4, type: 9 },   // RTL
  { name: "RC8_OPTION", value: 9, type: 9 },   // Camera Trigger
  { name: "RC9_OPTION", value: 0, type: 9 },
  { name: "RC10_OPTION", value: 0, type: 9 },
  { name: "RC11_OPTION", value: 0, type: 9 },
  { name: "RC12_OPTION", value: 0, type: 9 },
  { name: "RC13_OPTION", value: 0, type: 9 },
  { name: "RC14_OPTION", value: 0, type: 9 },
  { name: "RC15_OPTION", value: 0, type: 9 },
  { name: "RC16_OPTION", value: 0, type: 9 },

  // ── RC Global Settings ─────────────────────────────────────
  { name: "RC_PROTOCOLS", value: 1, type: 9 },
  { name: "RC_OPTIONS", value: 0, type: 9 },
  { name: "RC_FEEL_RP", value: 50, type: 9 },
  { name: "RC_OVERRIDE_TIME", value: 3, type: 9 },
  { name: "RC_SPEED", value: 50, type: 9 },

  // ── Servo Outputs ────────────────────────────────────
  { name: "SERVO1_FUNCTION", value: 33, type: 9 },  // Motor1
  { name: "SERVO1_MIN", value: 1000, type: 9 },
  { name: "SERVO1_MAX", value: 2000, type: 9 },
  { name: "SERVO1_TRIM", value: 1000, type: 9 },
  { name: "SERVO1_REVERSED", value: 0, type: 9 },
  { name: "SERVO2_FUNCTION", value: 34, type: 9 },  // Motor2
  { name: "SERVO2_MIN", value: 1000, type: 9 },
  { name: "SERVO2_MAX", value: 2000, type: 9 },
  { name: "SERVO2_TRIM", value: 1000, type: 9 },
  { name: "SERVO2_REVERSED", value: 0, type: 9 },
  { name: "SERVO3_FUNCTION", value: 35, type: 9 },  // Motor3
  { name: "SERVO3_MIN", value: 1000, type: 9 },
  { name: "SERVO3_MAX", value: 2000, type: 9 },
  { name: "SERVO3_TRIM", value: 1000, type: 9 },
  { name: "SERVO3_REVERSED", value: 0, type: 9 },
  { name: "SERVO4_FUNCTION", value: 36, type: 9 },  // Motor4
  { name: "SERVO4_MIN", value: 1000, type: 9 },
  { name: "SERVO4_MAX", value: 2000, type: 9 },
  { name: "SERVO4_TRIM", value: 1000, type: 9 },
  { name: "SERVO4_REVERSED", value: 0, type: 9 },
  { name: "SERVO5_FUNCTION", value: 0, type: 9 },   // Disabled
  { name: "SERVO5_MIN", value: 1000, type: 9 },
  { name: "SERVO5_MAX", value: 2000, type: 9 },
  { name: "SERVO5_TRIM", value: 1500, type: 9 },
  { name: "SERVO5_REVERSED", value: 0, type: 9 },
  { name: "SERVO6_FUNCTION", value: 0, type: 9 },
  { name: "SERVO6_MIN", value: 1000, type: 9 },
  { name: "SERVO6_MAX", value: 2000, type: 9 },
  { name: "SERVO6_TRIM", value: 1500, type: 9 },
  { name: "SERVO6_REVERSED", value: 0, type: 9 },
  { name: "SERVO7_FUNCTION", value: 0, type: 9 },
  { name: "SERVO7_MIN", value: 1000, type: 9 },
  { name: "SERVO7_MAX", value: 2000, type: 9 },
  { name: "SERVO7_TRIM", value: 1500, type: 9 },
  { name: "SERVO7_REVERSED", value: 0, type: 9 },
  { name: "SERVO8_FUNCTION", value: 0, type: 9 },
  { name: "SERVO8_MIN", value: 1000, type: 9 },
  { name: "SERVO8_MAX", value: 2000, type: 9 },
  { name: "SERVO8_TRIM", value: 1500, type: 9 },
  { name: "SERVO8_REVERSED", value: 0, type: 9 },
  { name: "SERVO9_FUNCTION", value: 0, type: 9 },
  { name: "SERVO9_MIN", value: 1000, type: 9 },
  { name: "SERVO9_MAX", value: 2000, type: 9 },
  { name: "SERVO9_TRIM", value: 1500, type: 9 },
  { name: "SERVO9_REVERSED", value: 0, type: 9 },
  { name: "SERVO10_FUNCTION", value: 0, type: 9 },
  { name: "SERVO10_MIN", value: 1000, type: 9 },
  { name: "SERVO10_MAX", value: 2000, type: 9 },
  { name: "SERVO10_TRIM", value: 1500, type: 9 },
  { name: "SERVO10_REVERSED", value: 0, type: 9 },
  { name: "SERVO11_FUNCTION", value: 0, type: 9 },
  { name: "SERVO11_MIN", value: 1000, type: 9 },
  { name: "SERVO11_MAX", value: 2000, type: 9 },
  { name: "SERVO11_TRIM", value: 1500, type: 9 },
  { name: "SERVO11_REVERSED", value: 0, type: 9 },
  { name: "SERVO12_FUNCTION", value: 0, type: 9 },
  { name: "SERVO12_MIN", value: 1000, type: 9 },
  { name: "SERVO12_MAX", value: 2000, type: 9 },
  { name: "SERVO12_TRIM", value: 1500, type: 9 },
  { name: "SERVO12_REVERSED", value: 0, type: 9 },
  { name: "SERVO13_FUNCTION", value: 0, type: 9 },
  { name: "SERVO13_MIN", value: 1000, type: 9 },
  { name: "SERVO13_MAX", value: 2000, type: 9 },
  { name: "SERVO13_TRIM", value: 1500, type: 9 },
  { name: "SERVO13_REVERSED", value: 0, type: 9 },
  { name: "SERVO14_FUNCTION", value: 0, type: 9 },
  { name: "SERVO14_MIN", value: 1000, type: 9 },
  { name: "SERVO14_MAX", value: 2000, type: 9 },
  { name: "SERVO14_TRIM", value: 1500, type: 9 },
  { name: "SERVO14_REVERSED", value: 0, type: 9 },
  { name: "SERVO15_FUNCTION", value: 0, type: 9 },
  { name: "SERVO15_MIN", value: 1000, type: 9 },
  { name: "SERVO15_MAX", value: 2000, type: 9 },
  { name: "SERVO15_TRIM", value: 1500, type: 9 },
  { name: "SERVO15_REVERSED", value: 0, type: 9 },
  { name: "SERVO16_FUNCTION", value: 0, type: 9 },
  { name: "SERVO16_MIN", value: 1000, type: 9 },
  { name: "SERVO16_MAX", value: 2000, type: 9 },
  { name: "SERVO16_TRIM", value: 1500, type: 9 },
  { name: "SERVO16_REVERSED", value: 0, type: 9 },
  { name: "SERVO_RATE", value: 50, type: 9 },

  // ── Battery / Power ──────────────────────────────────
  { name: "BATT_MONITOR", value: 4, type: 9 },
  { name: "BATT_CAPACITY", value: 5200, type: 9 },
  { name: "BATT_VOLT_PIN", value: 2, type: 9 },
  { name: "BATT_CURR_PIN", value: 3, type: 9 },
  { name: "BATT_VOLT_MULT", value: 10.1, type: 9 },
  { name: "BATT_AMP_PERVLT", value: 17.0, type: 9 },
  { name: "BATT_ARM_VOLT", value: 10.5, type: 9 },
  { name: "BATT_LOW_VOLT", value: 10.5, type: 9 },
  { name: "BATT_CRT_VOLT", value: 9.6, type: 9 },

  // ── Failsafes (ArduCopter) ───────────────────────────
  { name: "BATT_FS_VOLTSRC", value: 0, type: 9 },
  { name: "BATT_FS_LOW_VOLT", value: 10.5, type: 9 },
  { name: "BATT_FS_LOW_ACT", value: 2, type: 9 },   // RTL
  { name: "BATT_FS_CRT_VOLT", value: 9.9, type: 9 },
  { name: "BATT_FS_CRT_ACT", value: 1, type: 9 },   // Land
  { name: "FS_BATT_ENABLE", value: 1, type: 9 },
  { name: "FS_BATT_VOLTAGE", value: 10.5, type: 9 },
  { name: "FS_BATT_MAH", value: 0, type: 9 },
  { name: "FS_THR_ENABLE", value: 1, type: 9 },
  { name: "FS_THR_VALUE", value: 975, type: 9 },
  { name: "FS_GCS_ENABLE", value: 1, type: 9 },
  { name: "FS_GCS_TIMEOUT", value: 5, type: 9 },
  { name: "FS_EKF_ACTION", value: 1, type: 9 },
  { name: "FS_EKF_THRESH", value: 0.8, type: 9 },
  { name: "FS_CRASH_CHECK", value: 1, type: 9 },
  { name: "FS_OPTIONS", value: 0, type: 9 },

  // ── GPS / EKF / AHRS ────────────────────────────────
  { name: "GPS1_TYPE", value: 1, type: 9 },   // 4.6+ naming
  { name: "GPS_TYPE", value: 1, type: 9 },    // Pre-4.6 compat
  { name: "GPS_TYPE2", value: 0, type: 9 },
  { name: "GPS_AUTO_SWITCH", value: 1, type: 9 },
  { name: "GPS_PRIMARY", value: 0, type: 9 },
  { name: "GPS_BLEND_MASK", value: 5, type: 9 },
  { name: "GPS_GNSS_MODE", value: 0, type: 9 },
  { name: "GPS_RATE_MS", value: 200, type: 9 },
  { name: "GPS_SBAS_MODE", value: 0, type: 9 },
  { name: "GPS_MIN_ELEV", value: -100, type: 9 },
  { name: "GPS_AUTO_CONFIG", value: 1, type: 9 },
  { name: "GPS_NAVFILTER", value: 8, type: 9 },
  { name: "GPS_DRV_OPTIONS", value: 0, type: 9 },
  { name: "GPS_MB1_TYPE", value: 0, type: 9 },
  { name: "EK3_ENABLE", value: 1, type: 9 },
  { name: "EK3_GPS_TYPE", value: 0, type: 9 },
  { name: "EK3_IMU_MASK", value: 3, type: 9 },
  { name: "EK3_SRC1_POSXY", value: 3, type: 9 },
  { name: "EK3_SRC1_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC1_VELXY", value: 3, type: 9 },
  { name: "EK3_SRC1_VELZ", value: 3, type: 9 },
  { name: "EK3_SRC1_YAW", value: 1, type: 9 },         // 1 = Compass
  { name: "EK3_SRC2_POSXY", value: 6, type: 9 },       // VIO-primary set
  { name: "EK3_SRC2_VELXY", value: 6, type: 9 },
  { name: "EK3_SRC2_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC2_VELZ", value: 6, type: 9 },
  { name: "EK3_SRC2_YAW", value: 6, type: 9 },
  { name: "EK3_SRC3_POSXY", value: 0, type: 9 },       // OF-primary set
  { name: "EK3_SRC3_VELXY", value: 5, type: 9 },
  { name: "EK3_SRC3_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC3_VELZ", value: 0, type: 9 },
  { name: "EK3_SRC3_YAW", value: 1, type: 9 },
  { name: "EK3_SRC_OPTIONS", value: 2, type: 9 },      // bit 1 = AlignExtNavPosWhenUsingOptFlow
  { name: "EK3_FLOW_DELAY", value: 10, type: 9 },
  { name: "EK3_FLOW_QUAL_MIN", value: 50, type: 9 },
  { name: "AHRS_EKF_TYPE", value: 3, type: 9 },

  // ── Visual Odometry (VISO) ───────────────────────────
  { name: "VISO_TYPE", value: 0, type: 9 },           // 0 = None, 1 = MAVLink
  { name: "VISO_POS_X", value: 0.0, type: 9 },        // camera mount offset, body FRD, meters
  { name: "VISO_POS_Y", value: 0.0, type: 9 },
  { name: "VISO_POS_Z", value: 0.0, type: 9 },
  { name: "VISO_ORIENT", value: 0, type: 9 },         // 0 = Forward
  { name: "VISO_DELAY_MS", value: 10, type: 9 },
  { name: "VISO_VEL_M_NSE", value: 0.1, type: 9 },
  { name: "VISO_POS_M_NSE", value: 0.2, type: 9 },
  { name: "VISO_YAW_M_NSE", value: 0.2, type: 9 },
  { name: "VISO_SCALE", value: 1.0, type: 9 },

  // ── Arming / Frame / INS ─────────────────────────────
  { name: "ARMING_CHECK", value: 1, type: 9 },
  { name: "ARMING_RUDDER", value: 2, type: 9 },
  { name: "FRAME_CLASS", value: 1, type: 9 },    // Quad
  { name: "FRAME_TYPE", value: 1, type: 9 },     // X
  { name: "INS_GYRO_FILTER", value: 20, type: 9 },
  { name: "INS_ACCEL_FILTER", value: 20, type: 9 },
  { name: "INS_USE", value: 1, type: 9 },
  { name: "INS_USE2", value: 1, type: 9 },
  { name: "INS_ACC_BODYFIX", value: 2, type: 9 },
  { name: "INS_FAST_SAMPLE", value: 7, type: 9 },
  { name: "INS_LOG_BAT_CNT", value: 1024, type: 9 },
  { name: "INS_LOG_BAT_MASK", value: 1, type: 9 },

  // ── Motor / Navigation / Pilot ───────────────────────
  { name: "MOT_BAT_VOLT_MAX", value: 25.2, type: 9 },
  { name: "MOT_BAT_VOLT_MIN", value: 19.8, type: 9 },
  { name: "MOT_SPIN_ARM", value: 0.1, type: 9 },
  { name: "MOT_SPIN_MIN", value: 0.15, type: 9 },
  { name: "MOT_SPIN_MAX", value: 0.95, type: 9 },
  { name: "MOT_THST_EXPO", value: 0.65, type: 9 },
  { name: "MOT_THST_HOVER", value: 0.35, type: 9 },
  { name: "MOT_PWM_TYPE", value: 0, type: 9 },
  { name: "MOT_PWM_MIN", value: 1000, type: 9 },
  { name: "MOT_PWM_MAX", value: 2000, type: 9 },
  { name: "WPNAV_SPEED", value: 500, type: 9 },
  { name: "WPNAV_SPEED_DN", value: 150, type: 9 },
  { name: "WPNAV_SPEED_UP", value: 250, type: 9 },
  { name: "WPNAV_ACCEL", value: 100, type: 9 },
  { name: "WPNAV_RADIUS", value: 200, type: 9 },
  { name: "PILOT_SPEED_UP", value: 250, type: 9 },
  { name: "PILOT_SPEED_DN", value: 0, type: 9 },
  { name: "PILOT_ACCEL_Z", value: 250, type: 9 },
  { name: "PILOT_THR_FILT", value: 0, type: 9 },
  { name: "PILOT_TKOFF_ALT", value: 0, type: 9 },
  { name: "LOIT_SPEED", value: 500, type: 9 },
  { name: "LOIT_ACC_MAX", value: 250, type: 9 },
  { name: "LOIT_BRK_ACCEL", value: 250, type: 9 },
  { name: "LOIT_BRK_DELAY", value: 1, type: 9 },

  // ── Flight Modes ─────────────────────────────────────
  { name: "FLTMODE1", value: 0, type: 9 },   // STABILIZE
  { name: "FLTMODE2", value: 2, type: 9 },   // ALT_HOLD
  { name: "FLTMODE3", value: 5, type: 9 },   // LOITER
  { name: "FLTMODE4", value: 3, type: 9 },   // AUTO
  { name: "FLTMODE5", value: 6, type: 9 },   // RTL
  { name: "FLTMODE6", value: 9, type: 9 },   // LAND
  { name: "FLTMODE_CH", value: 5, type: 9 },
  { name: "SIMPLE", value: 0, type: 9 },
  { name: "SUPER_SIMPLE", value: 0, type: 9 },
  { name: "INITIAL_MODE", value: 0, type: 9 },

  // ── Stream Rates ─────────────────────────────────────
  { name: "SR0_RAW_SENS", value: 2, type: 9 },
  { name: "SR0_EXT_STAT", value: 2, type: 9 },
  { name: "SR0_RC_CHAN", value: 5, type: 9 },
  { name: "SR0_RAW_CTRL", value: 1, type: 9 },
  { name: "SR0_POSITION", value: 3, type: 9 },
  { name: "SR0_EXTRA1", value: 10, type: 9 },
  { name: "SR0_EXTRA2", value: 10, type: 9 },
  { name: "SR0_EXTRA3", value: 1, type: 9 },
  { name: "SR0_ADSB", value: 5, type: 9 },
  { name: "SR0_PARAMS", value: 10, type: 9 },

  // ── Compass ──────────────────────────────────────────
  { name: "COMPASS_USE", value: 1, type: 9 },
  { name: "COMPASS_USE2", value: 1, type: 9 },
  { name: "COMPASS_AUTODEC", value: 1, type: 9 },
  { name: "COMPASS_DEC", value: 0, type: 9 },
  { name: "COMPASS_MOT_X", value: 0, type: 9 },
  { name: "COMPASS_MOT_Y", value: 0, type: 9 },
  { name: "COMPASS_MOT_Z", value: 0, type: 9 },
  { name: "COMPASS_OFS_X", value: 5, type: 9 },
  { name: "COMPASS_OFS_Y", value: 13, type: 9 },
  { name: "COMPASS_OFS_Z", value: -18, type: 9 },
  { name: "COMPASS_ORIENT", value: 0, type: 9 },
  { name: "COMPASS_EXTERNAL", value: 1, type: 9 },

  // ── System ID ────────────────────────────────────────
  { name: "SYSID_THISMAV", value: 1, type: 9 },
  { name: "SYSID_MYGCS", value: 255, type: 9 },

  // ── Fence ────────────────────────────────────────────
  { name: "FENCE_ENABLE", value: 1, type: 9 },
  { name: "FENCE_TYPE", value: 7, type: 9 },   // ALT_MAX + CIRCLE + POLYGON
  { name: "FENCE_ACTION", value: 1, type: 9 },  // RTL
  { name: "FENCE_ALT_MAX", value: 120, type: 9 },
  { name: "FENCE_ALT_MIN", value: 0, type: 9 },
  { name: "FENCE_RADIUS", value: 300, type: 9 },
  { name: "FENCE_MARGIN", value: 2, type: 9 },
  { name: "FENCE_TOTAL", value: 5, type: 9 },

  // ── Logging ──────────────────────────────────────────
  { name: "LOG_BITMASK", value: 176126, type: 9 },
  { name: "LOG_BACKEND_TYPE", value: 1, type: 9 },
  { name: "LOG_DISARMED", value: 0, type: 9 },
  { name: "LOG_REPLAY", value: 0, type: 9 },
  { name: "LOG_FILE_DSRMROT", value: 1, type: 9 },

  // ── Mission / Land / RTL ─────────────────────────────
  { name: "MIS_TOTAL", value: 0, type: 9 },
  { name: "MIS_RESTART", value: 0, type: 9 },
  { name: "MIS_OPTIONS", value: 0, type: 9 },
  { name: "LAND_SPEED", value: 50, type: 9 },
  { name: "LAND_SPEED_HIGH", value: 0, type: 9 },
  { name: "LAND_ALT_LOW", value: 1000, type: 9 },
  { name: "LAND_REPOSITION", value: 1, type: 9 },
  { name: "RTL_ALT", value: 1500, type: 9 },
  { name: "RTL_ALT_FINAL", value: 0, type: 9 },
  { name: "RTL_CLIMB_MIN", value: 0, type: 9 },
  { name: "RTL_LOIT_TIME", value: 5000, type: 9 },
  { name: "RTL_SPEED", value: 0, type: 9 },
  { name: "RTL_CONE_SLOPE", value: 3, type: 9 },

  // ── Serial Ports ─────────────────────────────────────
  { name: "SERIAL0_PROTOCOL", value: 2, type: 9 },   // MAVLink2
  { name: "SERIAL0_BAUD", value: 115, type: 9 },
  { name: "SERIAL1_PROTOCOL", value: 2, type: 9 },
  { name: "SERIAL1_BAUD", value: 57, type: 9 },
  { name: "SERIAL2_PROTOCOL", value: -1, type: 9 },
  { name: "SERIAL2_BAUD", value: 57, type: 9 },
  { name: "SERIAL3_PROTOCOL", value: 5, type: 9 },   // GPS
  { name: "SERIAL3_BAUD", value: 38, type: 9 },
  { name: "SERIAL4_PROTOCOL", value: -1, type: 9 },
  { name: "SERIAL4_BAUD", value: 115, type: 9 },
  { name: "SERIAL5_PROTOCOL", value: -1, type: 9 },
  { name: "SERIAL5_BAUD", value: 57, type: 9 },
  { name: "SERIAL6_PROTOCOL", value: -1, type: 9 },
  { name: "SERIAL6_BAUD", value: 57, type: 9 },
  { name: "SERIAL7_PROTOCOL", value: -1, type: 9 },
  { name: "SERIAL7_BAUD", value: 57, type: 9 },

  // ── OSD ──────────────────────────────────────────────
  { name: "OSD_TYPE", value: 1, type: 9 },
  // Screen 1 items: OSDn_<ITEM>_EN / _X / _Y.
  { name: "OSD1_ENABLE", value: 1, type: 9 },
  { name: "OSD1_ALTITUDE_EN", value: 1, type: 9 },
  { name: "OSD1_ALTITUDE_X", value: 1, type: 9 },
  { name: "OSD1_ALTITUDE_Y", value: 1, type: 9 },
  { name: "OSD1_BAT_VOLT_EN", value: 1, type: 9 },
  { name: "OSD1_BAT_VOLT_X", value: 23, type: 9 },
  { name: "OSD1_BAT_VOLT_Y", value: 1, type: 9 },
  { name: "OSD1_RSSI_EN", value: 1, type: 9 },
  { name: "OSD1_RSSI_X", value: 26, type: 9 },
  { name: "OSD1_RSSI_Y", value: 0, type: 9 },
  { name: "OSD1_CURRENT_EN", value: 1, type: 9 },
  { name: "OSD1_CURRENT_X", value: 23, type: 9 },
  { name: "OSD1_CURRENT_Y", value: 2, type: 9 },
  { name: "OSD1_SATS_EN", value: 1, type: 9 },
  { name: "OSD1_SATS_X", value: 1, type: 9 },
  { name: "OSD1_SATS_Y", value: 0, type: 9 },
  { name: "OSD1_FLTMODE_EN", value: 1, type: 9 },
  { name: "OSD1_FLTMODE_X", value: 12, type: 9 },
  { name: "OSD1_FLTMODE_Y", value: 14, type: 9 },
  { name: "OSD1_MESSAGE_EN", value: 1, type: 9 },
  { name: "OSD1_MESSAGE_X", value: 1, type: 9 },
  { name: "OSD1_MESSAGE_Y", value: 13, type: 9 },
  { name: "OSD1_HORIZON_EN", value: 1, type: 9 },
  { name: "OSD1_HORIZON_X", value: 12, type: 9 },
  { name: "OSD1_HORIZON_Y", value: 7, type: 9 },
  { name: "OSD1_HEADING_EN", value: 1, type: 9 },
  { name: "OSD1_HEADING_X", value: 12, type: 9 },
  { name: "OSD1_HEADING_Y", value: 0, type: 9 },
  { name: "OSD1_HOMEDIST_EN", value: 0, type: 9 },
  { name: "OSD1_HOMEDIST_X", value: 23, type: 9 },
  { name: "OSD1_HOMEDIST_Y", value: 14, type: 9 },
  { name: "OSD1_THROTTLE_EN", value: 0, type: 9 },
  { name: "OSD1_THROTTLE_X", value: 23, type: 9 },
  { name: "OSD1_THROTTLE_Y", value: 8, type: 9 },

  // ── Geofence ───────────────────────────────────────
  { name: "FENCE_ENABLE", value: 0, type: 9 },
  { name: "FENCE_TYPE", value: 7, type: 9 },       // bitmask: alt+circle+polygon
  { name: "FENCE_ALT_MAX", value: 100, type: 9 },  // meters
  { name: "FENCE_ALT_MIN", value: -10, type: 9 },
  { name: "FENCE_RADIUS", value: 300, type: 9 },   // meters
  { name: "FENCE_MARGIN", value: 2, type: 9 },
  { name: "FENCE_ACTION", value: 1, type: 9 },     // RTL
  { name: "FENCE_TOTAL", value: 5, type: 9 },

  // ── Terrain ───────────────────────────────────────
  { name: "TERRAIN_ENABLE", value: 0, type: 9 },    // Disabled

  // ── Frame ──────────────────────────────────────────
  { name: "FRAME_CLASS", value: 1, type: 9 },      // Quad
  { name: "FRAME_TYPE", value: 1, type: 9 },       // X

  // ── Rangefinder ────────────────────────────────────
  { name: "RNGFND1_TYPE", value: 0, type: 9 },     // None
  { name: "RNGFND1_PIN", value: -1, type: 9 },
  { name: "RNGFND1_MIN_CM", value: 20, type: 9 },
  { name: "RNGFND1_MAX_CM", value: 700, type: 9 },
  { name: "RNGFND1_ORIENT", value: 25, type: 9 },  // Down
  // Second rangefinder instance (configured) to exercise multi-instance UI.
  { name: "RNGFND2_TYPE", value: 10, type: 9 },    // MAVLink
  { name: "RNGFND2_PIN", value: -1, type: 9 },
  { name: "RNGFND2_MIN_CM", value: 10, type: 9 },
  { name: "RNGFND2_MAX_CM", value: 5000, type: 9 },
  { name: "RNGFND2_ORIENT", value: 0, type: 9 },   // Forward

  // ── EKF3 source sets (non-GPS positioning) ────────────
  { name: "EK3_SRC1_POSXY", value: 3, type: 9 },   // GPS
  { name: "EK3_SRC1_VELXY", value: 3, type: 9 },   // GPS
  { name: "EK3_SRC1_POSZ", value: 1, type: 9 },    // Baro
  { name: "EK3_SRC1_VELZ", value: 3, type: 9 },    // GPS
  { name: "EK3_SRC1_YAW", value: 1, type: 9 },     // Compass
  { name: "EK3_SRC2_POSXY", value: 0, type: 9 },
  { name: "EK3_SRC2_VELXY", value: 5, type: 9 },   // OpticalFlow
  { name: "EK3_SRC2_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC2_VELZ", value: 0, type: 9 },
  { name: "EK3_SRC2_YAW", value: 1, type: 9 },
  { name: "EK3_SRC3_POSXY", value: 0, type: 9 },
  { name: "EK3_SRC3_VELXY", value: 0, type: 9 },
  { name: "EK3_SRC3_POSZ", value: 1, type: 9 },
  { name: "EK3_SRC3_VELZ", value: 0, type: 9 },
  { name: "EK3_SRC3_YAW", value: 1, type: 9 },
  { name: "EK3_SRC_OPTIONS", value: 0, type: 9 },
  // External nav + beacon backends
  { name: "VISO_TYPE", value: 0, type: 9 },
  { name: "VISO_DELAY_MS", value: 10, type: 9 },
  { name: "VISO_POS_M_NSE", value: 0.2, type: 9 },
  { name: "VISO_YAW_M_NSE", value: 0.2, type: 9 },
  { name: "VISO_ORIENT", value: 0, type: 9 },
  { name: "VISO_SCALE", value: 1, type: 9 },
  { name: "BCN_TYPE", value: 0, type: 9 },
  { name: "BCN_LATITUDE", value: 0, type: 9 },
  { name: "BCN_LONGITUDE", value: 0, type: 9 },
  { name: "BCN_ALT", value: 0, type: 9 },
  { name: "BCN_ORIENT_YAW", value: 0, type: 9 },

  // ── Optical Flow ───────────────────────────────────
  { name: "FLOW_TYPE", value: 0, type: 9 },
  { name: "FLOW_FXSCALER", value: 0, type: 9 },
  { name: "FLOW_FYSCALER", value: 0, type: 9 },
  { name: "FLOW_ORIENT_YAW", value: 0, type: 9 },
  { name: "FLOW_POS_X", value: 0.0, type: 9 },        // sensor mount offset, body FRD, meters
  { name: "FLOW_POS_Y", value: 0.0, type: 9 },
  { name: "FLOW_POS_Z", value: 0.0, type: 9 },
  { name: "FLOW_HEIGHT_MIN", value: 0.5, type: 9 },   // meters
  { name: "FLOW_HEIGHT_MAX", value: 25.0, type: 9 },  // meters

  // ── Airspeed offset (rest of ARSPD_* live in the plane/VTOL block below) ──
  { name: "ARSPD_OFFSET", value: 0, type: 9 },

  // ── Barometer ──────────────────────────────────────
  { name: "GND_ABS_PRESS", value: 101325, type: 9 },
  { name: "GND_TEMP", value: 25, type: 9 },
  { name: "BARO_PRIMARY", value: 0, type: 9 },

  // ── Calibration offsets (snapshot for before/after) ──
  { name: "INS_ACCOFFS_X", value: 0.012, type: 9 },
  { name: "INS_ACCOFFS_Y", value: -0.008, type: 9 },
  { name: "INS_ACCOFFS_Z", value: 0.245, type: 9 },
  { name: "INS_ACCSCAL_X", value: 1.001, type: 9 },
  { name: "INS_ACCSCAL_Y", value: 0.999, type: 9 },
  { name: "INS_ACCSCAL_Z", value: 1.002, type: 9 },
  { name: "INS_GYROFFS_X", value: -0.003, type: 9 },
  { name: "INS_GYROFFS_Y", value: 0.001, type: 9 },
  { name: "INS_GYROFFS_Z", value: 0.005, type: 9 },
  { name: "AHRS_TRIM_X", value: 0, type: 9 },
  { name: "AHRS_TRIM_Y", value: 0, type: 9 },
  { name: "AHRS_TRIM_Z", value: 0, type: 9 },

  // ── Gimbal / Mount ─────────────────────────────────
  { name: "MNT1_TYPE", value: 0, type: 9 },        // None
  { name: "MNT1_PITCH_MIN", value: -90, type: 9 },
  { name: "MNT1_PITCH_MAX", value: 0, type: 9 },
  { name: "MNT1_ROLL_MIN", value: -45, type: 9 },
  { name: "MNT1_ROLL_MAX", value: 45, type: 9 },
  { name: "MNT1_YAW_MIN", value: -180, type: 9 },
  { name: "MNT1_YAW_MAX", value: 180, type: 9 },
  { name: "MNT1_RC_RATE", value: 90, type: 9 },
  { name: "MNT1_DEFLT_MODE", value: 3, type: 9 },  // RC Targeting

  // ── Camera ─────────────────────────────────────────
  { name: "CAM1_TYPE", value: 0, type: 9 },
  { name: "CAM1_DURATION", value: 10, type: 9 },   // ms
  { name: "CAM1_SERVO_OFF", value: 1100, type: 9 },
  { name: "CAM1_SERVO_ON", value: 1300, type: 9 },
  { name: "CAM1_TRIGG_DIST", value: 0, type: 9 },

  // ── LED ────────────────────────────────────────────
  { name: "NTF_LED_TYPES", value: 257, type: 9 },  // Board + NeoPixel
  { name: "NTF_LED_LEN", value: 4, type: 9 },
  { name: "NTF_LED_BRIGHT", value: 3, type: 9 },
  { name: "NTF_LED_OVERRIDE", value: 0, type: 9 },

  // ── Filter / Notch ─────────────────────────────────
  { name: "INS_GYRO_FILTER", value: 20, type: 9 },
  { name: "INS_ACCEL_FILTER", value: 20, type: 9 },
  { name: "INS_HNTCH_ENABLE", value: 1, type: 9 },
  { name: "INS_HNTCH_MODE", value: 1, type: 9 },   // 1 = throttle-based
  { name: "INS_HNTCH_FREQ", value: 80, type: 9 },
  { name: "INS_HNTCH_BW", value: 40, type: 9 },
  { name: "INS_HNTCH_ATT", value: 40, type: 9 },
  { name: "INS_HNTCH_REF", value: 0.35, type: 9 },
  { name: "INS_HNTCH_HMNCS", value: 3, type: 9 },  // bitmask: 1st + 2nd harmonic
  { name: "INS_HNTCH_OPTS", value: 0, type: 9 },
  { name: "INS_HNTCH_FM_RAT", value: 1, type: 9 },
  { name: "INS_HNTC2_ENABLE", value: 0, type: 9 },
  // In-flight FFT
  { name: "FFT_ENABLE", value: 0, type: 9 },
  { name: "FFT_MINHZ", value: 50, type: 9 },
  { name: "FFT_MAXHZ", value: 450, type: 9 },
  { name: "FFT_SNR_REF", value: 25, type: 9 },

  // ── Failsafe Options ──────────────────────────────
  { name: "FS_THR_VALUE", value: 975, type: 9 },

  // ── RC Protocol / RSSI ──────────────────────────────
  { name: "RSSI_TYPE", value: 0, type: 9 },

  // ── Gimbal RC Input ──────────────────────────────────
  { name: "MNT1_RC_IN_TILT", value: 6, type: 9 },
  { name: "MNT1_RC_IN_ROLL", value: 0, type: 9 },
  { name: "MNT1_RC_IN_PAN", value: 7, type: 9 },

  // ── Telemetry Radio Extras ───────────────────────────
  { name: "SERIAL1_OPTIONS", value: 0, type: 9 },
  { name: "SERIAL2_OPTIONS", value: 0, type: 9 },

  // ── PID Filter ─────────────────────────────────────
  { name: "ATC_RAT_RLL_FLTT", value: 20, type: 9 },
  { name: "ATC_RAT_RLL_FLTD", value: 20, type: 9 },
  { name: "ATC_RAT_PIT_FLTT", value: 20, type: 9 },
  { name: "ATC_RAT_PIT_FLTD", value: 20, type: 9 },
  { name: "ATC_RAT_YAW_FLTT", value: 2, type: 9 },
  { name: "ATC_RAT_YAW_FLTD", value: 0, type: 9 },

  // ── Airspeed sensor (ARSPD_* — plane / VTOL) ─────────
  { name: "ARSPD_TYPE", value: 1, type: 9 },
  { name: "ARSPD_USE", value: 1, type: 9 },
  { name: "ARSPD_RATIO", value: 2.0, type: 9 },
  { name: "ARSPD_AUTOCAL", value: 0, type: 9 },
  { name: "ARSPD_OPTIONS", value: 0, type: 9 },
  { name: "ARSPD_PIN", value: 15, type: 9 },
  { name: "AIRSPEED_MIN", value: 12, type: 9 },
  { name: "AIRSPEED_MAX", value: 30, type: 9 },
  { name: "AIRSPEED_CRUISE", value: 18, type: 9 },

  // ── Gripper / payload (GRIP_*) ───────────────────────
  { name: "GRIP_ENABLE", value: 0, type: 9 },
  { name: "GRIP_TYPE", value: 1, type: 9 },   // 1 = Servo
  { name: "GRIP_GRAB", value: 1000, type: 9 },
  { name: "GRIP_RELEASE", value: 2000, type: 9 },
  { name: "GRIP_NEUTRAL", value: 1500, type: 9 },
  { name: "GRIP_AUTOCLOSE", value: 0, type: 9 },

  // ── ADS-B + avoidance (ADSB_*/AVD_*/AVOID_*) ─────────
  { name: "ADSB_TYPE", value: 0, type: 9 },
  { name: "ADSB_LIST_MAX", value: 25, type: 9 },
  { name: "ADSB_LIST_RADIUS", value: 2000, type: 9 },
  { name: "ADSB_ICAO_ID", value: 0, type: 9 },
  { name: "ADSB_EMIT_TYPE", value: 14, type: 9 },
  { name: "AVD_ENABLE", value: 0, type: 9 },
  { name: "AVD_F_ACTION", value: 2, type: 9 },
  { name: "AVD_F_DIST_XY", value: 300, type: 9 },
  { name: "AVD_F_DIST_Z", value: 100, type: 9 },
  { name: "AVOID_ENABLE", value: 7, type: 9 },
  { name: "AVOID_MARGIN", value: 2, type: 9 },
  { name: "AVOID_BEHAVE", value: 0, type: 9 },

];

// Traditional-helicopter defaults: the shared ArduCopter set with a heli frame
// class plus the H_* / AROT_* params, used by the `ardupilot-heli` mock
// variant. Later entries override earlier, so FRAME_CLASS becomes 6 (Heli).
export const HELI_MOCK_PARAMS: MockParam[] = [
  ...MOCK_PARAMS,
  { name: "FRAME_CLASS", value: 6, type: 9 },   // Heli
  // Swashplate & collective
  { name: "H_SW_TYPE", value: 3, type: 9 },
  { name: "H_COL_MIN", value: 1250, type: 9 },
  { name: "H_COL_MAX", value: 1750, type: 9 },
  { name: "H_COL_MID", value: 1500, type: 9 },
  { name: "H_COL_ANG_MIN", value: -2, type: 9 },
  { name: "H_COL_ANG_MAX", value: 10, type: 9 },
  { name: "H_CYC_MAX", value: 2500, type: 9 },
  { name: "H_PHANG", value: 0, type: 9 },
  { name: "H_FLYBAR_MODE", value: 0, type: 9 },
  // Rotor speed control
  { name: "H_RSC_MODE", value: 2, type: 9 },
  { name: "H_RSC_SETPOINT", value: 70, type: 9 },
  { name: "H_RSC_RAMP_TIME", value: 10, type: 9 },
  { name: "H_RSC_RUNUP_TIME", value: 10, type: 9 },
  { name: "H_RSC_CRITICAL", value: 55, type: 9 },
  { name: "H_RSC_IDLE", value: 0, type: 9 },
  { name: "H_RSC_SLEWRATE", value: 0, type: 9 },
  { name: "H_RSC_THRCRV_0", value: 25, type: 9 },
  { name: "H_RSC_THRCRV_25", value: 32, type: 9 },
  { name: "H_RSC_THRCRV_50", value: 38, type: 9 },
  { name: "H_RSC_THRCRV_75", value: 50, type: 9 },
  { name: "H_RSC_THRCRV_100", value: 100, type: 9 },
  // Governor
  { name: "H_RSC_GOV_RPM", value: 1500, type: 9 },
  { name: "H_RSC_GOV_DROOP", value: 15, type: 9 },
  { name: "H_RSC_GOV_RANGE", value: 100, type: 9 },
  { name: "H_RSC_GOV_COMP", value: 0, type: 9 },
  { name: "H_RSC_GOV_TORQUE", value: 30, type: 9 },
  // Autorotation
  { name: "AROT_ENABLE", value: 0, type: 9 },
  { name: "AROT_HS_SET", value: 1500, type: 9 },
  { name: "AROT_RSC_IDLE", value: 0, type: 9 },
  { name: "AROT_TAIL_ALT", value: 0, type: 9 },
  { name: "AROT_ENTRY_ALT", value: 20, type: 9 },
  { name: "AROT_BAIL_TIME", value: 2, type: 9 },
];

// ArduPlane: the shared base set with the ArduCopter-only failsafe params
// swapped for Plane's own short/long/GCS/throttle failsafe params and Plane's
// battery-action enum (1 = RTL, 2 = Land). Used by the `ardupilot-plane` mock
// variant and as the base of every QuadPlane variant.
const COPTER_ONLY_FAILSAFE: Record<string, true> = {
  FS_THR_ENABLE: true, FS_THR_VALUE: true, FS_GCS_ENABLE: true, FS_GCS_TIMEOUT: true,
  FS_EKF_ACTION: true, FS_CRASH_CHECK: true, FS_OPTIONS: true,
};

export const ARDUPLANE_MOCK_PARAMS: MockParam[] = [
  ...MOCK_PARAMS.filter((p) => !COPTER_ONLY_FAILSAFE[p.name]),
  { name: "FS_SHORT_ACTN", value: 0, type: 9 },   // CIRCLE / no change
  { name: "FS_LONG_ACTN", value: 1, type: 9 },    // ReturnToLaunch
  { name: "FS_LONG_TIMEOUT", value: 5, type: 9 },
  { name: "FS_GCS_ENABL", value: 1, type: 9 },    // Heartbeat
  { name: "THR_FAILSAFE", value: 1, type: 9 },    // Enabled
  { name: "THR_FS_VALUE", value: 950, type: 9 },
  { name: "BATT_FS_LOW_ACT", value: 1, type: 9 }, // RTL
  { name: "BATT_FS_CRT_ACT", value: 2, type: 9 }, // Land
];

// QuadPlane VTOL: the ArduPlane base set plus the Q_* quadplane lift group.
// Q_ENABLE=1 with a quad lift geometry makes the VTOL + Frame panels render
// populated. Used by the `ardupilot-plane-vtol` mock variant.
export const QUADPLANE_MOCK_PARAMS: MockParam[] = [
  ...ARDUPLANE_MOCK_PARAMS,
  { name: "Q_ENABLE", value: 1, type: 9 },
  { name: "Q_FRAME_CLASS", value: 1, type: 9 },   // 1 = Quad
  { name: "Q_FRAME_TYPE", value: 1, type: 9 },     // 1 = X
  { name: "Q_M_SPIN_ARM", value: 0.1, type: 9 },
  { name: "Q_M_SPIN_MIN", value: 0.15, type: 9 },
  { name: "Q_M_SPIN_MAX", value: 0.95, type: 9 },
  { name: "Q_M_PWM_MIN", value: 1000, type: 9 },
  { name: "Q_M_PWM_MAX", value: 2000, type: 9 },
  { name: "Q_ANGLE_MAX", value: 3000, type: 9 },
  { name: "Q_ASSIST_SPEED", value: 12, type: 9 },
  { name: "Q_ASSIST_ANGLE", value: 30, type: 9 },
  { name: "Q_VFWD_GAIN", value: 0.05, type: 9 },
  { name: "Q_WVANE_ENABLE", value: 1, type: 9 },
  { name: "Q_RTL_MODE", value: 1, type: 9 },
  { name: "Q_TRANSITION_MS", value: 5000, type: 9 },
  { name: "Q_TAILSIT_ENABLE", value: 0, type: 9 },
  { name: "Q_TILT_ENABLE", value: 0, type: 9 },
  // Lift motors on outputs 5-8
  { name: "SERVO5_FUNCTION", value: 33, type: 9 },  // Motor1
  { name: "SERVO6_FUNCTION", value: 34, type: 9 },  // Motor2
  { name: "SERVO7_FUNCTION", value: 35, type: 9 },  // Motor3
  { name: "SERVO8_FUNCTION", value: 36, type: 9 },  // Motor4
];

// Tailsitter VTOL: Q_FRAME_CLASS=10 with the Q_TAILSIT_* group enabled so the
// VtolPanel tailsitter section renders. Used by `ardupilot-plane-tailsitter`.
export const TAILSITTER_MOCK_PARAMS: MockParam[] = [
  ...QUADPLANE_MOCK_PARAMS,
  { name: "Q_FRAME_CLASS", value: 10, type: 9 },   // 10 = Tailsitter
  { name: "Q_TAILSIT_ENABLE", value: 1, type: 9 },
  { name: "Q_TAILSIT_ANGLE", value: 45, type: 9 },
  { name: "Q_TAILSIT_ANG_VT", value: 45, type: 9 },
  { name: "Q_TAILSIT_INPUT", value: 0, type: 9 },
  { name: "Q_TAILSIT_MASK", value: 0, type: 9 },
  { name: "Q_TAILSIT_MOTMX", value: 0, type: 9 },
  { name: "Q_TAILSIT_VFGAIN", value: 0.2, type: 9 },
  { name: "Q_TAILSIT_VHGAIN", value: 0.8, type: 9 },
  { name: "Q_TAILSIT_VHPOW", value: 1, type: 9 },
  { name: "Q_TAILSIT_THSCMX", value: 5, type: 9 },
];

// Tiltrotor VTOL: the Q_TILT_* group enabled (vectored-yaw tilt) so the
// VtolPanel tiltrotor section renders. Used by `ardupilot-plane-tiltrotor`.
export const TILTROTOR_MOCK_PARAMS: MockParam[] = [
  ...QUADPLANE_MOCK_PARAMS,
  { name: "Q_TILT_ENABLE", value: 1, type: 9 },
  { name: "Q_TILT_MASK", value: 3, type: 9 },       // front two motors tilt
  { name: "Q_TILT_TYPE", value: 2, type: 9 },       // 2 = vectored yaw
  { name: "Q_TILT_MAX", value: 45, type: 9 },
  { name: "Q_TILT_RATE_UP", value: 40, type: 9 },
  { name: "Q_TILT_RATE_DN", value: 30, type: 9 },
  { name: "Q_TILT_YAW_ANGLE", value: 15, type: 9 },
  { name: "Q_TILT_FIX_ANGLE", value: 0, type: 9 },
  { name: "Q_TILT_FIX_GAIN", value: 0, type: 9 },
  { name: "SERVO9_FUNCTION", value: 41, type: 9 },  // TiltMotorsFront
];

// ArduRover ground rover: a curated rover parameter set (FRAME_CLASS=1). The
// bundled ardupilot-rover metadata labels these. Used by `ardupilot-rover`.
export const ROVER_MOCK_PARAMS: MockParam[] = [
  { name: "FRAME_CLASS", value: 1, type: 9 },   // 1 = Rover
  { name: "FRAME_TYPE", value: 0, type: 9 },
  { name: "ARMING_CHECK", value: 1, type: 9 },
  { name: "ARMING_REQUIRE", value: 1, type: 9 },
  // Steering / throttle (Ackermann)
  { name: "SERVO1_FUNCTION", value: 26, type: 9 },  // GroundSteering
  { name: "SERVO3_FUNCTION", value: 70, type: 9 },  // Throttle
  { name: "SERVO1_MIN", value: 1000, type: 9 },
  { name: "SERVO1_MAX", value: 2000, type: 9 },
  { name: "SERVO1_TRIM", value: 1500, type: 9 },
  { name: "SERVO3_MIN", value: 1000, type: 9 },
  { name: "SERVO3_MAX", value: 2000, type: 9 },
  { name: "SERVO3_TRIM", value: 1500, type: 9 },
  // Speed / navigation
  { name: "CRUISE_SPEED", value: 3, type: 9 },
  { name: "CRUISE_THROTTLE", value: 40, type: 9 },
  { name: "WP_SPEED", value: 3, type: 9 },
  { name: "WP_RADIUS", value: 2, type: 9 },
  { name: "TURN_MAX_G", value: 0.6, type: 9 },
  { name: "TURN_RADIUS", value: 0.9, type: 9 },
  { name: "NAVL1_PERIOD", value: 8, type: 9 },
  { name: "NAVL1_DAMPING", value: 0.75, type: 9 },
  // Steering + speed controllers
  { name: "ATC_STR_RAT_P", value: 0.2, type: 9 },
  { name: "ATC_STR_RAT_I", value: 0.2, type: 9 },
  { name: "ATC_STR_RAT_D", value: 0.0, type: 9 },
  { name: "ATC_STR_RAT_MAX", value: 120, type: 9 },
  { name: "ATC_SPEED_P", value: 0.2, type: 9 },
  { name: "ATC_SPEED_I", value: 0.2, type: 9 },
  { name: "ATC_SPEED_D", value: 0.0, type: 9 },
  { name: "ATC_ACCEL_MAX", value: 1, type: 9 },
  { name: "ATC_BRAKE", value: 1, type: 9 },
  { name: "ATC_STOP_SPEED", value: 0.1, type: 9 },
  // Flight (drive) modes
  { name: "MODE_CH", value: 8, type: 9 },
  { name: "MODE1", value: 0, type: 9 },   // Manual
  { name: "MODE2", value: 4, type: 9 },   // Hold
  { name: "MODE3", value: 3, type: 9 },   // Steering
  { name: "MODE4", value: 10, type: 9 },  // Auto
  { name: "MODE5", value: 11, type: 9 },  // RTL
  { name: "MODE6", value: 15, type: 9 },  // Guided
  // Battery / power
  { name: "BATT_MONITOR", value: 4, type: 9 },
  { name: "BATT_CAPACITY", value: 10000, type: 9 },
  { name: "BATT_LOW_VOLT", value: 10.5, type: 9 },
  { name: "BATT_CRT_VOLT", value: 10.0, type: 9 },
  // GPS / compass / AHRS
  { name: "GPS_TYPE", value: 1, type: 9 },
  { name: "COMPASS_ENABLE", value: 1, type: 9 },
  { name: "COMPASS_USE", value: 1, type: 9 },
  { name: "AHRS_EKF_TYPE", value: 3, type: 9 },
  { name: "AHRS_ORIENTATION", value: 0, type: 9 },
  // Serial
  { name: "SERIAL0_BAUD", value: 115, type: 9 },
  { name: "SERIAL1_PROTOCOL", value: 2, type: 9 },
  { name: "SERIAL1_BAUD", value: 57, type: 9 },
  // Avoidance / proximity (present, mostly off)
  { name: "ADSB_TYPE", value: 0, type: 9 },
  { name: "AVOID_ENABLE", value: 3, type: 9 },
  { name: "AVOID_MARGIN", value: 2, type: 9 },
  { name: "PRX1_TYPE", value: 0, type: 9 },
];

// ArduRover boat / sailboat: the rover base as a boat (FRAME_CLASS=2) with the
// SAIL_* + WNDVN_* wind-vane group enabled so the Sailboat panel renders
// populated. Used by the `ardupilot-boat` mock variant.
export const BOAT_MOCK_PARAMS: MockParam[] = [
  ...ROVER_MOCK_PARAMS,
  { name: "FRAME_CLASS", value: 2, type: 9 },   // 2 = Boat
  { name: "PILOT_STEER_TYPE", value: 0, type: 9 },
  // Sailboat
  { name: "SAIL_ENABLE", value: 1, type: 9 },
  { name: "SAIL_ANGLE_MIN", value: 0, type: 9 },
  { name: "SAIL_ANGLE_MAX", value: 90, type: 9 },
  { name: "SAIL_ANGLE_IDEAL", value: 25, type: 9 },
  { name: "SAIL_HEEL_MAX", value: 15, type: 9 },
  { name: "SAIL_NO_GO", value: 45, type: 9 },
  { name: "SAIL_WNDSPD_MIN", value: 0.5, type: 9 },
  { name: "SAIL_XTRACK_MAX", value: 10, type: 9 },
  { name: "SAIL_LOIT_RADIUS", value: 5, type: 9 },
  // Wind vane
  { name: "WNDVN_TYPE", value: 1, type: 9 },
  { name: "WNDVN_DIR_PIN", value: 13, type: 9 },
  { name: "WNDVN_SPEED_TYPE", value: 0, type: 9 },
  { name: "WNDVN_DIR_OFS", value: 0, type: 9 },
  { name: "SERVO4_FUNCTION", value: 89, type: 9 },  // MainSail
];

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

  // ── RC channels (same as ArduPilot) ───────────────────
  { name: "RC1_MIN", value: 1100, type: 9 },
  { name: "RC1_MAX", value: 1900, type: 9 },
  { name: "RC1_TRIM", value: 1500, type: 9 },
  { name: "RC1_REVERSED", value: 0, type: 9 },
  { name: "RC2_MIN", value: 1100, type: 9 },
  { name: "RC2_MAX", value: 1900, type: 9 },
  { name: "RC2_TRIM", value: 1500, type: 9 },
  { name: "RC2_REVERSED", value: 0, type: 9 },
  { name: "RC3_MIN", value: 1100, type: 9 },
  { name: "RC3_MAX", value: 1900, type: 9 },
  { name: "RC3_TRIM", value: 1100, type: 9 },
  { name: "RC3_REVERSED", value: 0, type: 9 },
  { name: "RC4_MIN", value: 1100, type: 9 },
  { name: "RC4_MAX", value: 1900, type: 9 },
  { name: "RC4_TRIM", value: 1500, type: 9 },
  { name: "RC4_REVERSED", value: 0, type: 9 },
  { name: "RC1_DZ", value: 10, type: 9 },
  { name: "RC2_DZ", value: 10, type: 9 },
  { name: "RC3_DZ", value: 10, type: 9 },
  { name: "RC4_DZ", value: 10, type: 9 },

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
  { name: "TRIG_DIST", value: 25, type: 9 },
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

/**
 * Betaflight parameters for demo mode.
 *
 * Realistic BF parameter names with typical defaults covering
 * PID, rates, motor, battery, failsafe, GPS, blackbox, VTX, and features.
 */
export const BETAFLIGHT_MOCK_PARAMS: MockParam[] = [
  // ── PID ────────────────────────────────────────────────
  { name: "BF_PID_ROLL_P", value: 45, type: 9 },
  { name: "BF_PID_ROLL_I", value: 80, type: 9 },
  { name: "BF_PID_ROLL_D", value: 40, type: 9 },
  { name: "BF_PID_PITCH_P", value: 47, type: 9 },
  { name: "BF_PID_PITCH_I", value: 84, type: 9 },
  { name: "BF_PID_PITCH_D", value: 46, type: 9 },
  { name: "BF_PID_YAW_P", value: 45, type: 9 },
  { name: "BF_PID_YAW_I", value: 80, type: 9 },
  { name: "BF_PID_YAW_D", value: 0, type: 9 },
  { name: "BF_PID_ROLL_F", value: 120, type: 9 },
  { name: "BF_PID_PITCH_F", value: 125, type: 9 },
  { name: "BF_PID_YAW_F", value: 120, type: 9 },
  // ── Rates ──────────────────────────────────────────────
  { name: "BF_RC_RATE", value: 100, type: 9 },
  { name: "BF_RC_EXPO", value: 0, type: 9 },
  { name: "BF_ROLL_RATE", value: 70, type: 9 },
  { name: "BF_PITCH_RATE", value: 70, type: 9 },
  { name: "BF_YAW_RATE", value: 60, type: 9 },
  { name: "BF_RC_YAW_EXPO", value: 0, type: 9 },
  { name: "BF_RC_YAW_RATE", value: 100, type: 9 },
  { name: "BF_THROTTLE_MID", value: 50, type: 9 },
  { name: "BF_THROTTLE_EXPO", value: 0, type: 9 },
  // ── Motor ──────────────────────────────────────────────
  { name: "BF_MOTOR_MIN_THROTTLE", value: 1070, type: 9 },
  { name: "BF_MOTOR_MAX_THROTTLE", value: 2000, type: 9 },
  { name: "BF_MOTOR_MIN_COMMAND", value: 1000, type: 9 },
  { name: "BF_MOTOR_IDLE_PCT", value: 550, type: 9 },
  { name: "BF_MOTOR_PWM_PROTOCOL", value: 5, type: 9 },
  { name: "BF_MOTOR_PWM_RATE", value: 480, type: 9 },
  // ── Battery ────────────────────────────────────────────
  { name: "BF_BATT_MIN_CELL", value: 330, type: 9 },
  { name: "BF_BATT_MAX_CELL", value: 430, type: 9 },
  { name: "BF_BATT_WARNING_CELL", value: 350, type: 9 },
  { name: "BF_BATT_CAPACITY", value: 0, type: 9 },
  // ── Features & arming ─────────────────────────────────
  { name: "BF_FEATURE_MASK", value: 0x20000064, type: 9 },
  { name: "BF_AUTO_DISARM_DELAY", value: 5, type: 9 },
  { name: "BF_SMALL_ANGLE", value: 25, type: 9 },
  { name: "BF_BEEPER_DISABLED_MASK", value: 0, type: 9 },
  // ── Filters ────────────────────────────────────────────
  { name: "BF_GYRO_LPF_HZ", value: 250, type: 9 },
  { name: "BF_DTERM_LPF_HZ", value: 100, type: 9 },
  { name: "BF_GYRO_NOTCH_HZ", value: 0, type: 9 },
  { name: "BF_GYRO_NOTCH_CUTOFF", value: 0, type: 9 },
  { name: "BF_DTERM_NOTCH_HZ", value: 0, type: 9 },
  { name: "BF_DTERM_NOTCH_CUTOFF", value: 0, type: 9 },
  { name: "BF_GYRO_SYNC_DENOM", value: 1, type: 9 },
  { name: "BF_PID_PROCESS_DENOM", value: 1, type: 9 },
  // ── Failsafe ───────────────────────────────────────────
  { name: "BF_FS_DELAY", value: 4, type: 9 },
  { name: "BF_FS_PROCEDURE", value: 0, type: 9 },
  // ── GPS ────────────────────────────────────────────────
  { name: "BF_GPS_PROVIDER", value: 1, type: 9 },
  { name: "BF_GPS_SBAS_MODE", value: 0, type: 9 },
  { name: "BF_GPS_AUTO_CONFIG", value: 1, type: 9 },
  { name: "BF_GPS_AUTO_BAUD", value: 0, type: 9 },
  { name: "BF_GPS_USE_GALILEO", value: 0, type: 9 },
  { name: "BF_GPS_RESCUE_ANGLE", value: 30, type: 9 },
  { name: "BF_GPS_RESCUE_INITIAL_ALT", value: 30, type: 9 },
  { name: "BF_GPS_RESCUE_DESCENT_DIST", value: 200, type: 9 },
  { name: "BF_GPS_RESCUE_GROUND_SPEED", value: 750, type: 9 },
  { name: "BF_GPS_RESCUE_THROTTLE_MIN", value: 1100, type: 9 },
  { name: "BF_GPS_RESCUE_THROTTLE_MAX", value: 1600, type: 9 },
  { name: "BF_GPS_RESCUE_THROTTLE_HOVER", value: 1280, type: 9 },
  { name: "BF_GPS_RESCUE_SANITY_CHECKS", value: 1, type: 9 },
  { name: "BF_GPS_RESCUE_MIN_SATS", value: 8, type: 9 },
  // ── Blackbox ───────────────────────────────────────────
  { name: "BF_BLACKBOX_DEVICE", value: 1, type: 9 },
  { name: "BF_BLACKBOX_RATE_NUM", value: 1, type: 9 },
  { name: "BF_BLACKBOX_RATE_DENOM", value: 1, type: 9 },
  // ── VTX ────────────────────────────────────────────────
  { name: "BF_VTX_TYPE", value: 2, type: 9 },
  { name: "BF_VTX_BAND", value: 4, type: 9 },
  { name: "BF_VTX_CHANNEL", value: 1, type: 9 },
  { name: "BF_VTX_POWER", value: 1, type: 9 },
  { name: "BF_VTX_PIT_MODE", value: 0, type: 9 },
  { name: "BF_VTX_FREQUENCY", value: 0, type: 9 },
  { name: "BF_VTX_LOW_POWER_DISARM", value: 0, type: 9 },

  // ── Scripting (SCR_*) ────────────────────────────────
  { name: "SCR_ENABLE", value: 1, type: 9 },
  { name: "SCR_HEAP_SIZE", value: 102400, type: 9 },
  { name: "SCR_VM_I_COUNT", value: 10000, type: 9 },
  { name: "SCR_DEBUG_OPTS", value: 0, type: 9 },
  { name: "SCR_DIR_DISABLE", value: 0, type: 9 },
  { name: "SCR_THD_PRIORITY", value: 0, type: 9 },
];
