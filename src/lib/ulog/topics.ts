/**
 * PX4 uORB topic → canonical TelemetryFrame channel mapping.
 *
 * A topic maps to a channel only when its rows normalize to that channel's
 * contract (the live telemetry shapes in `@/lib/types/telemetry`, in the same
 * units). A topic whose row has no faithful mapping is left out rather than
 * passed through raw: a raw uORB row under a channel's name renders as empty
 * or wrong-unit series, and interleaves with the rows that do conform.
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

  vehicle_attitude: "attitude",
  battery_status: "battery",

  // The blended solution the estimator uses. The per-receiver sensor_gps
  // instances would interleave a second receiver's fixes into the same series.
  vehicle_gps_position: "gps",

  // Barometric altitude.
  vehicle_air_data: "vfr",

  // Accelerometer + gyro in one row.
  sensor_combined: "scaledImu",

  actuator_outputs: "servoOutput",
  input_rc: "rc",

  // The topic was renamed; a log carries one or the other.
  wind_estimate: "wind",
  wind: "wind",

  estimator_status: "ekf",
  distance_sensor: "distanceSensor",
  home_position: "homePosition",
};

/** Standard gravity, m/s², for the m/s² → mg conversion. */
const G = 9.80665;

/**
 * Transform a PX4 uORB topic row into the GCS-expected data shape.
 *
 * PX4 field names and units differ from MAVLink. This normalizes each mapped
 * topic to the live telemetry contract; a field the row does not carry stays
 * absent rather than defaulting to 0.
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
    // flight builder derives it from `alt` and the home altitude. Current PX4
    // carries no velocity or yaw here (they live in vehicle_local_position,
    // which the flight builder joins in); an older log that still has
    // vel_n/vel_e/yaw is read directly.
    case "vehicle_global_position": {
      const velN = num(row.vel_n);
      const velE = num(row.vel_e);
      const yaw = num(row.yaw);
      return {
        lat: num(row.lat),
        lon: num(row.lon),
        alt: num(row.alt),
        ...(velN !== undefined && velE !== undefined
          ? { groundSpeed: Math.hypot(velN, velE) }
          : {}),
        ...(yaw !== undefined ? { heading: radToHeading(yaw) } : {}),
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

    // `remaining` is a 0..1 fraction, negative when the estimator has none;
    // the battery contract marks "not estimated" with -1.
    case "battery_status": {
      const remaining = num(row.remaining);
      return {
        voltage: num(row.voltage_v) ?? num(row.voltage_filtered_v),
        current: num(row.current_a) ?? num(row.current_filtered_a),
        remaining: remaining === undefined || remaining < 0 ? -1 : remaining * 100,
        consumed: num(row.discharged_mah),
        temperature: num(row.temperature),
      };
    }

    // PX4 1.14 moved the fix to float64 degrees / metres
    // (latitude_deg, longitude_deg, altitude_msl_m); older logs carry the
    // int32 1e-7 degree / mm fields.
    case "vehicle_gps_position": {
      const latDeg = num(row.latitude_deg);
      const lonDeg = num(row.longitude_deg);
      const altM = num(row.altitude_msl_m);
      const lat = num(row.lat);
      const lon = num(row.lon);
      const alt = num(row.alt);
      return {
        fixType: num(row.fix_type),
        satellites: num(row.satellites_used),
        hdop: num(row.hdop),
        lat: latDeg ?? (lat !== undefined ? lat / 1e7 : undefined),
        lon: lonDeg ?? (lon !== undefined ? lon / 1e7 : undefined),
        alt: altM ?? (alt !== undefined ? alt / 1e3 : undefined),
      };
    }

    // Barometric altitude only: the topic carries no throttle, airspeed,
    // groundspeed or heading, so none is reported.
    case "vehicle_air_data":
      return { alt: num(row.baro_alt_meter) };

    case "wind_estimate":
    case "wind": {
      const north = num(row.windspeed_north);
      const east = num(row.windspeed_east);
      if (north === undefined || east === undefined) return {};
      return {
        // The direction the wind blows FROM, degrees.
        direction: (Math.atan2(-east, -north) * RAD_TO_DEG + 360) % 360,
        speed: Math.hypot(north, east),
      };
    }

    // PWM microseconds, the same unit as MAVLink RC_CHANNELS.
    case "input_rc":
      return {
        channels: Array.isArray(row.values) ? row.values : [],
        rssi: num(row.rssi),
      };

    // Output values in the actuator's own unit (PWM microseconds on a PWM
    // output), the live ServoOutputData shape.
    case "actuator_outputs":
      return { servos: Array.isArray(row.output) ? row.output : [] };

    // SCALED_IMU units: accelerometer in mg, gyro in mrad/s.
    case "sensor_combined": {
      const acc = Array.isArray(row.accelerometer_m_s2) ? row.accelerometer_m_s2 as number[] : [];
      const gyro = Array.isArray(row.gyro_rad) ? row.gyro_rad as number[] : [];
      const mg = (v: unknown) => {
        const n = num(v);
        return n === undefined ? undefined : (n / G) * 1000;
      };
      const mrad = (v: unknown) => {
        const n = num(v);
        return n === undefined ? undefined : n * 1000;
      };
      return {
        xacc: mg(acc[0]),
        yacc: mg(acc[1]),
        zacc: mg(acc[2]),
        xgyro: mrad(gyro[0]),
        ygyro: mrad(gyro[1]),
        zgyro: mrad(gyro[2]),
      };
    }

    // The innovation test ratios, which is what PX4 itself reports in the
    // variance fields of MAVLink EKF_STATUS_REPORT.
    case "estimator_status":
      return {
        velocityVariance: num(row.vel_test_ratio),
        posHorizVariance: num(row.pos_test_ratio),
        posVertVariance: num(row.hgt_test_ratio),
        compassVariance: num(row.mag_test_ratio),
        terrainAltVariance: num(row.hagl_test_ratio),
        flags: num(row.solution_status_flags),
      };

    // Metres on the topic; centimetres in the live DISTANCE_SENSOR contract.
    case "distance_sensor": {
      const cm = (v: unknown) => {
        const n = num(v);
        return n === undefined ? undefined : n * 100;
      };
      return {
        currentDistance: cm(row.current_distance),
        minDistance: cm(row.min_distance),
        maxDistance: cm(row.max_distance),
        orientation: num(row.orientation),
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

/** Radians (any range) → compass heading degrees in [0, 360). */
export function radToHeading(rad: number): number {
  return ((rad * RAD_TO_DEG) % 360 + 360) % 360;
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
