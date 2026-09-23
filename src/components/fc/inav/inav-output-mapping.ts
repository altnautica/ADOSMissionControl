/**
 * @module inav-output-mapping
 * @description iNav timer-output tables: the per-timer output mode override
 * (`outputMode_e`) and the timer usage flags reported by
 * MSP2_INAV_OUTPUT_MAPPING_EXT2 (`timerUsageFlag_e`, drivers/timer.h).
 * @license GPL-3.0-only
 */

/** iNav `outputMode_e`: what a timer's outputs are forced to drive. */
export const TIMER_OUTPUT_MODE_OPTIONS = [
  { value: "0", label: "Auto" },
  { value: "1", label: "Motors" },
  { value: "2", label: "Servos" },
  { value: "3", label: "LED" },
  { value: "4", label: "PINIO" },
  { value: "5", label: "Beeper" },
];

/** iNav `timerUsageFlag_e` bits, in the order they are listed. */
const TIM_USE_BITS: ReadonlyArray<[number, string]> = [
  [1 << 0, "PPM"],
  [1 << 1, "PWM"],
  [1 << 2, "MOTOR"],
  [1 << 3, "SERVO"],
  [1 << 24, "LED"],
  [1 << 25, "BEEPER"],
  [1 << 26, "PINIO"],
];

/** The usage flags as labels, with any unnamed bits shown in hex. */
export function timerUsageLabel(flags: number): string {
  if (flags === 0) return "NONE";
  const parts: string[] = [];
  let known = 0;
  for (const [bit, label] of TIM_USE_BITS) {
    if (flags & bit) {
      parts.push(label);
      known |= bit;
    }
  }
  const rest = (flags & ~known) >>> 0;
  if (rest) parts.push(`0x${rest.toString(16)}`);
  return parts.join("+");
}
