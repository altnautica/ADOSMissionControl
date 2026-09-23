/**
 * Betaflight motor protocol (`motorProtocolTypes_e`, drivers/motor_types.h),
 * the value MSP_ADVANCED_CONFIG carries. DShot1200 was removed, so 8 is
 * ProShot1000 and 9 disables motor output. DroneCAN (10) exists on firmware
 * that has the CAN motor driver.
 *
 * @license GPL-3.0-only
 */
export const ESC_PROTOCOLS = [
  { value: "0", label: "PWM" }, { value: "1", label: "OneShot125" },
  { value: "2", label: "OneShot42" }, { value: "3", label: "MultiShot" },
  { value: "4", label: "Brushed" }, { value: "5", label: "DShot150" },
  { value: "6", label: "DShot300" }, { value: "7", label: "DShot600" },
  { value: "8", label: "ProShot1000" }, { value: "9", label: "Disabled (no motor output)" },
  { value: "10", label: "DroneCAN" },
];

/** DShot150/300/600: the protocols that carry DShot special commands. */
export function isDshotProtocol(protocol: number): boolean {
  return protocol >= 5 && protocol <= 7;
}

/** PWM, OneShot, MultiShot and brushed all run at the configured PWM rate. */
export function usesPwmRate(protocol: number): boolean {
  return protocol >= 0 && protocol <= 4;
}
