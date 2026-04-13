/**
 * PX4 uORB topic → canonical TelemetryFrame channel mapping.
 *
 * Phase 30.
 *
 * @module ulog/topics
 * @license GPL-3.0-only
 */

/** Maps a PX4 uORB topic name to the canonical channel used by the GCS. */
export const TOPIC_TO_CHANNEL: Record<string, string> = {
  // Position / navigation
  vehicle_local_position: "position",
  vehicle_global_position: "globalPosition",
  vehicle_local_position_setpoint: "localPosition",

  // Attitude
  vehicle_attitude: "attitude",

  // Battery
  battery_status: "battery",

  // GPS
  vehicle_gps_position: "gps",
  sensor_gps: "gps",

  // VFR-equivalent (airdata)
  vehicle_air_data: "vfr",
  airspeed_validated: "vfr",

  // IMU
  sensor_combined: "scaledImu",
  sensor_accel: "scaledImu",
  sensor_gyro: "scaledImu",
  vehicle_imu: "scaledImu",

  // Vibration
  sensor_accel_fifo: "vibration",
  estimator_sensor_bias: "vibration",

  // Servo / actuator outputs
  actuator_outputs: "servoOutput",
  actuator_controls_0: "servoOutput",

  // RC input
  manual_control_setpoint: "rc",
  input_rc: "rc",
  rc_channels: "rc",

  // Wind
  wind_estimate: "wind",
  wind: "wind",

  // EKF
  estimator_status: "ekf",
  estimator_states: "ekf",
  vehicle_local_position_groundtruth: "ekf",

  // Vehicle status (for arm/disarm detection)
  vehicle_status: "sysStatus",

  // Magnetometer
  vehicle_magnetometer: "scaledImu",
  sensor_mag: "scaledImu",

  // Terrain
  distance_sensor: "distanceSensor",

  // Home
  home_position: "homePosition",
};

/**
 * Transform a PX4 uORB topic row into the GCS-expected data shape.
 *
 * PX4 field names differ from MAVLink. This normalizes the most common
 * fields so the existing telemetry store and chart infrastructure works.
 */
export function normalizeTopicData(
  topic: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  switch (topic) {
    case "vehicle_local_position":
      return {
        lat: num(row.ref_lat),
        lon: num(row.ref_lon),
        alt: num(row.z) !== undefined ? -(num(row.z)!) : undefined, // NED → AGL
        relativeAlt: num(row.z) !== undefined ? -(num(row.z)!) : undefined,
        groundSpeed: Math.sqrt((num(row.vx) ?? 0) ** 2 + (num(row.vy) ?? 0) ** 2),
        climbRate: num(row.vz) !== undefined ? -(num(row.vz)!) : undefined,
        heading: num(row.heading),
      };

    case "vehicle_global_position":
      return {
        lat: num(row.lat),
        lon: num(row.lon),
        alt: num(row.alt),
        relativeAlt: num(row.alt_ellipsoid),
        groundSpeed: Math.sqrt((num(row.vel_n) ?? 0) ** 2 + (num(row.vel_e) ?? 0) ** 2),
        heading: num(row.yaw),
      };

    case "vehicle_attitude": {
      const q = Array.isArray(row.q) ? row.q as number[] : undefined;
      return {
        roll: q && q.length >= 4 ? quatToEulerRoll(q) : num(row.roll),
        pitch: q && q.length >= 4 ? quatToEulerPitch(q) : num(row.pitch),
        yaw: q && q.length >= 4 ? quatToEulerYaw(q) : num(row.yaw),
      };
    }

    case "battery_status":
      return {
        voltage: num(row.voltage_v) ?? num(row.voltage_filtered_v),
        current: num(row.current_a) ?? num(row.current_filtered_a),
        remaining: num(row.remaining) !== undefined ? (num(row.remaining)! * 100) : undefined,
        consumed: num(row.discharged_mah),
        temperature: num(row.temperature),
      };

    case "vehicle_gps_position":
    case "sensor_gps":
      return {
        fixType: num(row.fix_type),
        satellites: num(row.satellites_used),
        hdop: num(row.hdop),
        lat: num(row.lat) !== undefined ? num(row.lat)! / 1e7 : undefined,
        lon: num(row.lon) !== undefined ? num(row.lon)! / 1e7 : undefined,
        alt: num(row.alt) !== undefined ? num(row.alt)! / 1e3 : undefined,
      };

    case "vehicle_air_data":
      return {
        alt: num(row.baro_alt_meter),
        climb: num(row.baro_alt_meter) !== undefined ? 0 : undefined, // No direct climb from airdata
        throttle: 0,
        airspeed: 0,
        groundspeed: 0,
        heading: 0,
      };

    case "wind_estimate":
    case "wind":
      return {
        direction: num(row.windspeed_north) !== undefined
          ? (Math.atan2(-(num(row.windspeed_east) ?? 0), -(num(row.windspeed_north) ?? 0)) * 180 / Math.PI + 360) % 360
          : undefined,
        speed: Math.sqrt((num(row.windspeed_north) ?? 0) ** 2 + (num(row.windspeed_east) ?? 0) ** 2),
      };

    case "manual_control_setpoint":
    case "input_rc":
    case "rc_channels":
      return {
        channels: row.values ?? row.channels ?? [
          num(row.x) ?? 0, num(row.y) ?? 0, num(row.z) ?? 0, num(row.r) ?? 0,
        ],
      };

    case "actuator_outputs":
      return { channels: row.output ?? [] };

    case "sensor_combined": {
      const acc = Array.isArray(row.accelerometer_m_s2) ? row.accelerometer_m_s2 as number[] : [];
      const gyro = Array.isArray(row.gyro_rad) ? row.gyro_rad as number[] : [];
      return {
        xacc: num(acc[0]),
        yacc: num(acc[1]),
        zacc: num(acc[2]),
        xgyro: num(gyro[0]),
        ygyro: num(gyro[1]),
        zgyro: num(gyro[2]),
      };
    }

    default:
      return row;
  }
}

// Helpers

function num(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

function quatToEulerRoll(q: number[]): number {
  return Math.atan2(2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));
}

function quatToEulerPitch(q: number[]): number {
  const sinp = 2 * (q[0] * q[2] - q[3] * q[1]);
  return Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
}

function quatToEulerYaw(q: number[]): number {
  return Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));
}
