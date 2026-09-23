/** The Betaflight motor and loop-rate settings the Motors panel reads and writes. */
export const BF_MOTORS_PARAM_NAMES = [
  "BF_MOTOR_MIN_THROTTLE", "BF_MOTOR_MAX_THROTTLE", "BF_MOTOR_MIN_COMMAND",
  "BF_MOTOR_IDLE_PCT", "BF_MOTOR_PWM_PROTOCOL", "BF_MOTOR_PWM_RATE",
  "BF_GYRO_SYNC_DENOM", "BF_PID_PROCESS_DENOM",
] as const;
