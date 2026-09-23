/**
 * @module firmware/px4-params
 * @description PX4 parameter name mapping (canonical ArduPilot -> PX4).
 */

// ---------------------------------------------------------------------------
// PX4 parameter name mapping (canonical ArduPilot -> PX4)
// ---------------------------------------------------------------------------

export const PX4_PARAM_MAP: Record<string, string> = {
  // ── PID rate (inner loop) ─────────────────────────────
  ATC_RAT_RLL_P: 'MC_ROLLRATE_P',
  ATC_RAT_RLL_I: 'MC_ROLLRATE_I',
  ATC_RAT_RLL_D: 'MC_ROLLRATE_D',
  ATC_RAT_RLL_FF: 'MC_ROLLRATE_FF',
  ATC_RAT_PIT_P: 'MC_PITCHRATE_P',
  ATC_RAT_PIT_I: 'MC_PITCHRATE_I',
  ATC_RAT_PIT_D: 'MC_PITCHRATE_D',
  ATC_RAT_PIT_FF: 'MC_PITCHRATE_FF',
  ATC_RAT_YAW_P: 'MC_YAWRATE_P',
  ATC_RAT_YAW_I: 'MC_YAWRATE_I',
  ATC_RAT_YAW_D: 'MC_YAWRATE_D',
  ATC_RAT_YAW_FF: 'MC_YAWRATE_FF',

  // ── PID angle (outer loop) ────────────────────────────
  ATC_ANG_RLL_P: 'MC_ROLL_P',
  ATC_ANG_PIT_P: 'MC_PITCH_P',
  ATC_ANG_YAW_P: 'MC_YAW_P',

  // ── Receiver channel mapping ──────────────────────────
  RCMAP_ROLL: 'RC_MAP_ROLL',
  RCMAP_PITCH: 'RC_MAP_PITCH',
  RCMAP_YAW: 'RC_MAP_YAW',
  RCMAP_THROTTLE: 'RC_MAP_THROTTLE',

  // ── Flight modes ──────────────────────────────────────
  FLTMODE_CH: 'RC_MAP_FLTMODE',
  FLTMODE1: 'COM_FLTMODE1',
  FLTMODE2: 'COM_FLTMODE2',
  FLTMODE3: 'COM_FLTMODE3',
  FLTMODE4: 'COM_FLTMODE4',
  FLTMODE5: 'COM_FLTMODE5',
  FLTMODE6: 'COM_FLTMODE6',

  // ── Power / battery ───────────────────────────────────
  BATT_MONITOR: 'BAT1_SOURCE',
  BATT_CAPACITY: 'BAT1_CAPACITY',
  BATT_VOLT_MULT: 'BAT1_V_DIV',
  BATT_AMP_PERVLT: 'BAT1_A_PER_V',
  // Volts at the current-sensor ADC input at zero current, like ArduPilot's
  // BATT_AMP_OFFSET; PX4 has one shared offset for every analog battery.
  BATT_AMP_OFFSET: 'BAT_V_OFFS_CURR',
  BATT2_MONITOR: 'BAT2_SOURCE',
  BATT2_CAPACITY: 'BAT2_CAPACITY',
  BATT2_VOLT_MULT: 'BAT2_V_DIV',
  BATT2_AMP_PERVLT: 'BAT2_A_PER_V',

  // ── Failsafe ──────────────────────────────────────────
  FS_THR_ENABLE: 'COM_RC_LOSS_T',
  FS_THR_VALUE: 'RC_FAILS_THR',
  FS_GCS_ENABLE: 'COM_DL_LOSS_T',
  BATT_FS_LOW_ACT: 'COM_LOW_BAT_ACT',
  // BAT_LOW_THR / BAT_CRIT_THR are remaining-charge FRACTIONS (0.15 = 15 %),
  // not volts; PX4 panels render them as such.
  BATT_FS_LOW_VOLT: 'BAT_LOW_THR',
  BATT_FS_CRT_VOLT: 'BAT_CRIT_THR',

  // ── Geofence ──────────────────────────────────────────
  FENCE_ENABLE: 'GF_ACTION',
  FENCE_ALT_MAX: 'GF_MAX_VER_DIST',
  FENCE_RADIUS: 'GF_MAX_HOR_DIST',

  // ── Compass calibration offsets ───────────────────────
  COMPASS_OFS_X: 'CAL_MAG0_XOFF',
  COMPASS_OFS_Y: 'CAL_MAG0_YOFF',
  COMPASS_OFS_Z: 'CAL_MAG0_ZOFF',
  COMPASS_OFS2_X: 'CAL_MAG1_XOFF',
  COMPASS_OFS2_Y: 'CAL_MAG1_YOFF',
  COMPASS_OFS2_Z: 'CAL_MAG1_ZOFF',
  COMPASS_ORIENT: 'CAL_MAG0_ROT',

  // ── Accelerometer calibration (offset + scale) ────────
  INS_ACCOFFS_X: 'CAL_ACC0_XOFF',
  INS_ACCOFFS_Y: 'CAL_ACC0_YOFF',
  INS_ACCOFFS_Z: 'CAL_ACC0_ZOFF',
  INS_ACCSCAL_X: 'CAL_ACC0_XSCALE',
  INS_ACCSCAL_Y: 'CAL_ACC0_YSCALE',
  INS_ACCSCAL_Z: 'CAL_ACC0_ZSCALE',

  // ── Gyroscope calibration offsets ─────────────────────
  INS_GYROFFS_X: 'CAL_GYRO0_XOFF',
  INS_GYROFFS_Y: 'CAL_GYRO0_YOFF',
  INS_GYROFFS_Z: 'CAL_GYRO0_ZOFF',

  // ── Board level / AHRS trim (board rotation offsets) ──
  AHRS_TRIM_X: 'SENS_BOARD_X_OFF',
  AHRS_TRIM_Y: 'SENS_BOARD_Y_OFF',
  AHRS_TRIM_Z: 'SENS_BOARD_Z_OFF',

  // ── Altitude / position ───────────────────────────────
  WPNAV_SPEED: 'MPC_XY_VEL_MAX',
  WPNAV_SPEED_UP: 'MPC_Z_VEL_MAX_UP',
  WPNAV_SPEED_DN: 'MPC_Z_VEL_MAX_DN',
  WPNAV_ACCEL: 'MPC_ACC_HOR',
  PILOT_ACCEL_Z: 'MPC_ACC_UP_MAX',

  // ── General config ────────────────────────────────────
  ARMING_CHECK: 'COM_ARM_CHK_MODE',
  ARMING_REQUIRE: 'COM_ARM_AUTH_REQ',
  LAND_SPEED: 'MPC_LAND_SPEED',
  RTL_ALT: 'RTL_RETURN_ALT',

  // ── PX4-only PID gain multipliers (passthrough) ──
  MC_ROLLRATE_K: 'MC_ROLLRATE_K',
  MC_PITCHRATE_K: 'MC_PITCHRATE_K',
  MC_YAWRATE_K: 'MC_YAWRATE_K',

  // ── PX4 battery extras ─────────────────────────────────────
  BAT1_N_CELLS: 'BAT1_N_CELLS',
  BAT1_R_INTERNAL: 'BAT1_R_INTERNAL',

  // ── Sensors / rangefinder ─────
  SENS_EN_MB12XX: 'SENS_EN_MB12XX',
  SENS_EN_LL40LS: 'SENS_EN_LL40LS',
  SENS_EN_SF1XX: 'SENS_EN_SF1XX',
  EKF2_RNG_AID: 'EKF2_RNG_AID',
  EKF2_RNG_A_HMAX: 'EKF2_RNG_A_HMAX',
  EKF2_RNG_NOISE: 'EKF2_RNG_NOISE',
  EKF2_RNG_SFE: 'EKF2_RNG_SFE',
  EKF2_MIN_RNG: 'EKF2_MIN_RNG',

  // ── External vision (EV) — PX4-only, passthrough ──
  EKF2_EV_CTRL: 'EKF2_EV_CTRL',
  EKF2_EV_DELAY: 'EKF2_EV_DELAY',
  EKF2_EV_GATE: 'EKF2_EV_GATE',
  EKF2_EV_NOISE_MD: 'EKF2_EV_NOISE_MD',
  EKF2_EV_POS_X: 'EKF2_EV_POS_X',
  EKF2_EV_POS_Y: 'EKF2_EV_POS_Y',
  EKF2_EV_POS_Z: 'EKF2_EV_POS_Z',
  EKF2_EV_QMIN: 'EKF2_EV_QMIN',
  EKF2_EVP_NOISE: 'EKF2_EVP_NOISE',
  EKF2_EVV_NOISE: 'EKF2_EVV_NOISE',
  EKF2_EVA_NOISE: 'EKF2_EVA_NOISE',

  // ── Optical flow (OF) — PX4-only, passthrough ──
  EKF2_OF_CTRL: 'EKF2_OF_CTRL',
  EKF2_OF_DELAY: 'EKF2_OF_DELAY',
  EKF2_OF_GATE: 'EKF2_OF_GATE',
  EKF2_OF_N_MAX: 'EKF2_OF_N_MAX',
  EKF2_OF_N_MIN: 'EKF2_OF_N_MIN',
  EKF2_OF_POS_X: 'EKF2_OF_POS_X',
  EKF2_OF_POS_Y: 'EKF2_OF_POS_Y',
  EKF2_OF_POS_Z: 'EKF2_OF_POS_Z',
  EKF2_OF_QMIN: 'EKF2_OF_QMIN',
  EKF2_OF_GYR_SRC: 'EKF2_OF_GYR_SRC',

  // ── EKF2 top-level — PX4-only, passthrough ──
  EKF2_HGT_REF: 'EKF2_HGT_REF',
  EKF2_AID_MASK: 'EKF2_AID_MASK',
  SENS_FLOW_MAXR: 'SENS_FLOW_MAXR',

  // ── Optical flow orientation ──────────────────────────
  FLOW_ORIENT_YAW: 'SENS_FLOW_ROT',

  // ── GPS antenna body-frame offset ─────────────────────
  GPS_POS1_X: 'EKF2_GPS_POS_X',
  GPS_POS1_Y: 'EKF2_GPS_POS_Y',
  GPS_POS1_Z: 'EKF2_GPS_POS_Z',

  // ── MAVLink identity ──────────────────────────────────
  SYSID_THISMAV: 'MAV_SYS_ID',

  // ── Gimbal ───────────────────────────────
  MNT1_TYPE: 'MNT_MODE_IN',
  MNT1_RC_IN_TILT: 'MNT_MAN_PITCH',
  MNT1_RC_IN_ROLL: 'MNT_MAN_ROLL',
  MNT1_RC_IN_PAN: 'MNT_MAN_YAW',
  MNT1_RC_RATE: 'MNT_RATE_PITCH',

  // ── Camera ─────────────────────────────
  CAM1_TYPE: 'TRIG_MODE',
  CAM1_DURATION: 'TRIG_ACT_TIME',
  CAM1_TRIGG_DIST: 'TRIG_DIST',
  CAM1_SERVO_ON: 'TRIG_PWM_SHOOT',
  CAM1_SERVO_OFF: 'TRIG_PWM_NEUTRAL',

  // ── EKF failsafe (PX4-only, passthrough) ────────────────────
  COM_POS_FS_EPH: 'COM_POS_FS_EPH',
  COM_VEL_FS_EVH: 'COM_VEL_FS_EVH',

  // ── Geofence extras ─────────────────────────────────────────
  GF_ALTMODE: 'GF_ALTMODE',
  GF_SOURCE: 'GF_SOURCE',

  // ── Serial ports ────────────────────────────────
  SER_TEL1_BAUD: 'SER_TEL1_BAUD',
  SER_TEL2_BAUD: 'SER_TEL2_BAUD',
  SER_TEL3_BAUD: 'SER_TEL3_BAUD',
  SER_GPS1_BAUD: 'SER_GPS1_BAUD',

  // ── Airframe / actuator (PX4-only) ─────────────────────────
  SYS_AUTOSTART: 'SYS_AUTOSTART',
  SYS_AUTOCONFIG: 'SYS_AUTOCONFIG',
  CA_ROTOR_COUNT: 'CA_ROTOR_COUNT',

  // Intentionally NOT mapped (no clean 1:1 PX4 equivalent; the two firmwares'
  // parameter trees diverge here, so an unmapped name passes through unchanged):
  //   MNT1_DEFLT_MODE ..... PX4 MNT_MODE_OUT is the gimbal wire protocol, not
  //                         the default operating mode.
  //   MNT1_{PITCH,ROLL,YAW}_{MIN,MAX} ... PX4 uses one MNT_RANGE_* per axis,
  //                         not a min/max pair.
  //   BATT_FS_CRT_ACT ..... PX4 has a single COM_LOW_BAT_ACT (already used by
  //                         BATT_FS_LOW_ACT); no separate critical-action param.
  //   BATT_FS_{LOW,CRT}_MAH, BATT2_FS_* ... PX4 has no mAh-based or per-battery
  //                         failsafe actions.
  //   BATT2_AMP_OFFSET .... PX4 has one current-sensor offset for every analog
  //                         battery (BAT_V_OFFS_CURR, mapped from BATT_AMP_OFFSET).
  //   FLOW_TYPE, FLOW_F{X,Y}SCALER ... PX4 enables optical flow per-driver and
  //                         has no matching type/scaler params.
  //   RNGFND1_{TYPE,PIN,MIN_CM,MAX_CM,ORIENT} ... PX4 enables rangefinders per
  //                         driver (SENS_EN_*), no single equivalent.
  //   FRAME_CLASS, FRAME_TYPE, Q_FRAME_* ... PX4 selects an airframe via
  //                         SYS_AUTOSTART, not class/type.
  //   SERIAL{1,2}_PROTOCOL ... PX4 assigns port protocols with a different
  //                         model (MAV_*_CONFIG), not per-serial protocol IDs.
  //   NTF_LED_*, GND_ABS_PRESS, GND_TEMP, SYSID_MYGCS, COMPASS_EXTERNAL ... no
  //                         matching PX4 parameter.
}

export const PX4_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PX4_PARAM_MAP).map(([k, v]) => [v, k])
)
