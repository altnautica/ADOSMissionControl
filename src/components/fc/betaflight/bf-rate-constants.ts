/** The Betaflight rate-profile settings the Rate Profile panel reads and writes. */
export const BF_RATE_PARAM_NAMES = [
  "BF_RC_RATE", "BF_RC_EXPO", "BF_ROLL_RATE", "BF_PITCH_RATE",
  "BF_RC_PITCH_RATE", "BF_RC_PITCH_EXPO",
  "BF_YAW_RATE", "BF_RC_YAW_EXPO", "BF_RC_YAW_RATE",
  "BF_THROTTLE_MID", "BF_THROTTLE_EXPO",
] as const;

/**
 * Trailing MSP_RC_TUNING fields that older firmware does not send: without
 * `rates_type` the profile uses Betaflight rates, without a rate limit the
 * firmware maximum applies.
 */
export const BF_RATE_OPTIONAL_PARAM_NAMES = [
  "BF_RATES_TYPE", "BF_ROLL_RATE_LIMIT", "BF_PITCH_RATE_LIMIT", "BF_YAW_RATE_LIMIT",
] as const;
