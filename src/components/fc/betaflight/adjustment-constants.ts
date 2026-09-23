/**
 * Betaflight in-flight adjustment functions, keyed by the firmware's
 * `adjustmentFunction_e` value (fc/rc_adjustments.h). That value is what
 * MSP_ADJUSTMENT_RANGES reads and MSP_SET_ADJUSTMENT_RANGE writes, so the
 * array index MUST equal the enum ordinal. 0 is "no function".
 */
export const ADJUSTMENT_FUNCTION_NAMES = [
  "None",
  "RC Rate",
  "RC Expo",
  "Throttle Expo",
  "Pitch & Roll Rate",
  "Yaw Rate",
  "Pitch & Roll P",
  "Pitch & Roll I",
  "Pitch & Roll D",
  "Yaw P",
  "Yaw I",
  "Yaw D",
  "Rate Profile",
  "Pitch Rate",
  "Roll Rate",
  "Pitch P",
  "Pitch I",
  "Pitch D",
  "Roll P",
  "Roll I",
  "Roll D",
  "RC Rate Yaw",
  "Pitch & Roll Feedforward",
  "Feedforward Transition",
  "Horizon Strength",
  "Roll RC Rate",
  "Pitch RC Rate",
  "Roll RC Expo",
  "Pitch RC Expo",
  "PID Audio",
  "Pitch Feedforward",
  "Roll Feedforward",
  "Yaw Feedforward",
  "OSD Profile",
  "LED Profile",
] as const;

export const ADJUSTMENT_FUNCTIONS = ADJUSTMENT_FUNCTION_NAMES.map((label, value) => ({
  value: String(value),
  label,
}));

/** Label for a firmware adjustment function; an unknown id shows as its raw number. */
export function adjustmentFunctionLabel(fn: number): string {
  return ADJUSTMENT_FUNCTION_NAMES[fn] ?? `Function ${fn}`;
}

export const AUX_CHANNELS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: `AUX ${i + 1}`,
}));
