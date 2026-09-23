// Sensor panel parameter names and option arrays

export const SENSOR_PARAMS = [
  "GND_ABS_PRESS", "GND_TEMP", "BARO_PRIMARY",
];

// ArduPilot supports up to 10 rangefinders: RNGFND1..RNGFND9 then RNGFNDA.
// Instance 1 is handled inline (with live distance); 2..A are the extra
// instances rendered on demand.
export const RNGFND_EXTRA_INSTANCES = ["2", "3", "4", "5", "6", "7", "8", "9", "A"] as const;
export const RNGFND_INSTANCE_FIELDS = ["TYPE", "PIN", "MIN_CM", "MAX_CM", "ORIENT"] as const;
export const RNGFND_EXTRA_PARAMS = RNGFND_EXTRA_INSTANCES.flatMap((n) =>
  RNGFND_INSTANCE_FIELDS.map((f) => `RNGFND${n}_${f}`),
);

export const OPTIONAL_SENSOR_PARAMS = [
  "RNGFND1_TYPE", "RNGFND1_PIN", "RNGFND1_MIN_CM", "RNGFND1_MAX_CM", "RNGFND1_ORIENT",
  ...RNGFND_EXTRA_PARAMS,
  "FLOW_TYPE", "FLOW_FXSCALER", "FLOW_FYSCALER", "FLOW_ORIENT_YAW",
  "ARSPD_TYPE", "ARSPD_USE", "ARSPD_OFFSET", "ARSPD_RATIO",
  // PX4 rangefinder and EKF2 range params (silently fail on ArduPilot)
  "SENS_EN_MB12XX", "SENS_EN_LL40LS", "SENS_EN_SF1XX",
  "EKF2_RNG_AID", "EKF2_RNG_A_HMAX", "EKF2_RNG_NOISE", "EKF2_RNG_SFE", "EKF2_MIN_RNG",
];
