/**
 * @module lib/sensor-health
 * @description The one decoder for SYS_STATUS's MAV_SYS_STATUS_SENSOR
 * bitmasks (present / enabled / healthy) into per-sensor verdicts.
 * @license GPL-3.0-only
 */

/**
 * A present sensor's verdict: `healthy`; `error` when it is enabled but not
 * healthy (a real fault); `disabled` when present but switched off. Absent
 * sensors are `not_present`.
 */
export type SensorStatus = "healthy" | "error" | "disabled" | "not_present";

export interface SensorInfo {
  bit: number;
  /** Stable id, e.g. "pre_arm_check". */
  name: string;
  label: string;
  shortLabel: string;
  present: boolean;
  enabled: boolean;
  healthy: boolean;
  status: SensorStatus;
}

/** The bitmask fields SYS_STATUS carries. */
export interface SensorBitmasks {
  sensorsPresent: number;
  sensorsEnabled: number;
  sensorsHealthy: number;
}

const SENSOR_BITS: readonly (readonly [bit: number, name: string, label: string, shortLabel: string])[] = [
  [0, "gyro_3d", "3D Gyro", "Gyro"],
  [1, "accel_3d", "3D Accel", "Accel"],
  [2, "mag_3d", "3D Mag", "Compass"],
  [3, "abs_pressure", "Abs Pressure", "Baro"],
  [4, "diff_pressure", "Diff Pressure", "Pitot"],
  [5, "gps", "GPS", "GPS"],
  [6, "optical_flow", "Optical Flow", "Flow"],
  [7, "vision_position", "Vision Position", "Vision"],
  [8, "laser_position", "Laser Position", "LiDAR"],
  [9, "external_ground_truth", "External GT", "ExtGT"],
  [10, "angular_rate_control", "Rate Control", "RateCtl"],
  [11, "attitude_stabilization", "Attitude Stab", "AttCtl"],
  [12, "yaw_position", "Yaw Position", "YawPos"],
  [13, "z_altitude_control", "Z/Alt Control", "AltCtl"],
  [14, "xy_position_control", "XY Position", "PosCtl"],
  [15, "motor_outputs", "Motor Outputs", "Motors"],
  [16, "rc_receiver", "RC Receiver", "RC"],
  [17, "gyro2_3d", "3D Gyro 2", "Gyro2"],
  [18, "accel2_3d", "3D Accel 2", "Accel2"],
  [19, "mag2_3d", "3D Mag 2", "Compass2"],
  [20, "geofence", "Geofence", "Fence"],
  [21, "ahrs", "AHRS", "AHRS"],
  [22, "terrain", "Terrain", "Terrain"],
  [23, "reverse_motor", "Reverse Motor", "RevMot"],
  [24, "logging", "Logging", "Log"],
  [25, "battery", "Battery", "Batt"],
  [26, "proximity", "Proximity", "Prox"],
  [27, "satcom", "Satcom", "SatCom"],
  [28, "pre_arm_check", "Pre-Arm Check", "PreArm"],
  [29, "obstacle_avoidance", "Obstacle Avoid", "ObsAvoid"],
  [30, "propulsion", "Propulsion", "Prop"],
  [31, "extension", "Extension", "Ext"],
];

/** Decode every defined sensor bit, present or not. */
export function decodeSensorHealth(masks: SensorBitmasks): SensorInfo[] {
  return SENSOR_BITS.map(([bit, name, label, shortLabel]) => {
    // `>>> 0` keeps bit 31 a positive mask.
    const mask = (1 << bit) >>> 0;
    const present = (masks.sensorsPresent & mask) !== 0;
    const enabled = (masks.sensorsEnabled & mask) !== 0;
    const healthy = (masks.sensorsHealthy & mask) !== 0;
    const status: SensorStatus = !present
      ? "not_present"
      : healthy
        ? "healthy"
        : enabled
          ? "error"
          : "disabled";
    return { bit, name, label, shortLabel, present, enabled, healthy, status };
  });
}

/** Healthy and present counts over decoded sensors. */
export function sensorCounts(sensors: readonly SensorInfo[]): { healthy: number; present: number } {
  let healthy = 0;
  let present = 0;
  for (const s of sensors) {
    if (s.present) present++;
    if (s.status === "healthy") healthy++;
  }
  return { healthy, present };
}
