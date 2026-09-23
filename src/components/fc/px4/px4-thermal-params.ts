/**
 * @module fc/px4/px4-thermal-params
 * @description The PX4 parameters the thermal-calibration panel reads and
 * writes: per-type TC_*_ENABLE, the SYS_CAL_* next-boot triggers and start
 * window, and the per-instance TC_* ranges.
 * @license GPL-3.0-only
 */

export const SENSOR_TYPES = [
  { key: "A", label: "Accelerometer", enable: "TC_A_ENABLE", trigger: "SYS_CAL_ACCEL" },
  { key: "G", label: "Gyroscope", enable: "TC_G_ENABLE", trigger: "SYS_CAL_GYRO" },
  { key: "B", label: "Barometer", enable: "TC_B_ENABLE", trigger: "SYS_CAL_BARO" },
] as const;

export const INSTANCES = [0, 1, 2] as const;
const FIELDS = ["ID", "TMIN", "TMAX", "TREF"] as const;

export const ENABLE_OPTIONS = [
  { value: "0", label: "Disabled" },
  { value: "1", label: "Enabled" },
];

export const TRIGGER_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "Calibrate at next power-up" },
];

/** Start-condition limits the onboard routine checks before it runs. */
export const LIMITS = [
  { name: "SYS_CAL_TMIN", label: "Min Start Temp", unit: "°C" },
  { name: "SYS_CAL_TMAX", label: "Max Start Temp", unit: "°C" },
  { name: "SYS_CAL_TDEL", label: "Required Rise", unit: "°C" },
] as const;

// PX4 starts thermal calibration at the next power-up for each sensor type
// whose SYS_CAL_ACCEL / SYS_CAL_GYRO / SYS_CAL_BARO is 1, within the
// SYS_CAL_TMIN..TMAX start window and until the temperature has risen by
// SYS_CAL_TDEL. The per-instance TC_* fields exist only for instances that
// have been calibrated, so they are optional.
const CORE_PARAMS = [
  ...SENSOR_TYPES.flatMap((t) => [t.enable, t.trigger]),
  ...LIMITS.map((l) => l.name),
];
const INSTANCE_PARAMS = SENSOR_TYPES.flatMap((t) =>
  INSTANCES.flatMap((i) => FIELDS.map((f) => `TC_${t.key}${i}_${f}`)),
);
export const PARAM_NAMES = [...CORE_PARAMS];
export const OPTIONAL_NAMES = [...INSTANCE_PARAMS];
