/**
 * PX4 uORB topic → canonical TelemetryFrame channel mapping.
 *
 * @module ulog/topics
 * @license GPL-3.0-only
 */

/** Maps a PX4 uORB topic name to the canonical channel used by the GCS. */
export const TOPIC_TO_CHANNEL: Record<string, string> = {
  // Position / navigation. vehicle_local_position is the EKF NED frame, not a
  // geographic fix: it maps to localPosition, never to a lat/lon channel.
  vehicle_local_position: "localPosition",
  vehicle_global_position: "globalPosition",

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
        x: num(row.x),
        y: num(row.y),
        z: num(row.z),
        vx: num(row.vx),
        vy: num(row.vy),
        vz: num(row.vz),
      };

    // `relativeAlt` (height above home) is not a field of this topic; the
    // flight builder derives it from `alt` and the home altitude.
    case "vehicle_global_position": {
      // PositionData.heading is degrees 0..360; the topic's yaw is radians.
      const yaw = num(row.yaw);
      return {
        lat: num(row.lat),
        lon: num(row.lon),
        alt: num(row.alt),
        groundSpeed: Math.sqrt((num(row.vel_n) ?? 0) ** 2 + (num(row.vel_e) ?? 0) ** 2),
        heading: yaw === undefined ? undefined : ((yaw * RAD_TO_DEG) % 360 + 360) % 360,
      };
    }

    // Recorded attitude is in degrees, the same contract as live AttitudeData.
    case "vehicle_attitude": {
      const q = Array.isArray(row.q) ? row.q as number[] : undefined;
      const roll = q && q.length >= 4 ? quatToEulerRoll(q) : num(row.roll);
      const pitch = q && q.length >= 4 ? quatToEulerPitch(q) : num(row.pitch);
      const yaw = q && q.length >= 4 ? quatToEulerYaw(q) : num(row.yaw);
      return {
        roll: roll === undefined ? undefined : roll * RAD_TO_DEG,
        pitch: pitch === undefined ? undefined : pitch * RAD_TO_DEG,
        yaw: yaw === undefined ? undefined : yaw * RAD_TO_DEG,
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

    // Barometric altitude only: the topic carries no throttle, airspeed,
    // groundspeed or heading, so none is reported.
    case "vehicle_air_data":
      return { alt: num(row.baro_alt_meter) };

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

const RAD_TO_DEG = 180 / Math.PI;

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
