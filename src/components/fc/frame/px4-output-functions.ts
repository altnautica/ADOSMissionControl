/**
 * @module fc/frame/px4-output-functions
 * @description PX4 actuator output-function codes (PWM_MAIN_FUNCn and the
 * other *_FUNCn params), as defined by the PX4 mixer module's output-function
 * list. Used as the option list when the flight controller's own parameter
 * metadata is not available; the metadata enum takes precedence when it is.
 * @license GPL-3.0-only
 */

export interface OutputFunctionOption {
  value: string;
  label: string;
}

function range(start: number, count: number, name: string): OutputFunctionOption[] {
  return Array.from({ length: count }, (_, i) => ({
    value: String(start + i),
    label: `${name} ${i + 1}`,
  }));
}

export const PX4_OUTPUT_FUNCTION_OPTIONS: readonly OutputFunctionOption[] = [
  { value: "0", label: "Disabled" },
  { value: "1", label: "Constant Min" },
  { value: "2", label: "Constant Max" },
  ...range(101, 12, "Motor"),
  ...range(201, 15, "Servo"),
  ...range(301, 6, "Peripheral via Actuator Set"),
  { value: "400", label: "Landing Gear" },
  { value: "401", label: "Parachute" },
  { value: "402", label: "RC Roll" },
  { value: "403", label: "RC Pitch" },
  { value: "404", label: "RC Throttle" },
  { value: "405", label: "RC Yaw" },
  { value: "406", label: "RC Flaps" },
  ...range(407, 6, "RC AUX"),
  { value: "420", label: "Gimbal Roll" },
  { value: "421", label: "Gimbal Pitch" },
  { value: "422", label: "Gimbal Yaw" },
  { value: "430", label: "Gripper" },
  { value: "440", label: "Landing Gear Wheel" },
  { value: "450", label: "IC Engine Ignition" },
  { value: "451", label: "IC Engine Throttle" },
  { value: "452", label: "IC Engine Choke" },
  { value: "453", label: "IC Engine Starter" },
  { value: "2000", label: "Camera Trigger" },
  { value: "2032", label: "Camera Capture" },
  { value: "2064", label: "PPS Input" },
  { value: "2070", label: "RPM Input" },
];
