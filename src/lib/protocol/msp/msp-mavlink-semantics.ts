/**
 * @module protocol/msp/msp-mavlink-semantics
 * @description The per-firmware translation of MSP values into the MAVLink
 * semantics the rest of the GCS reads: sensor bitmask layout, GPS fix type and
 * RC RSSI scale (with its "not reported" sentinel), so the telemetry dispatch
 * only unpacks bytes and scales units.
 *
 * Sensors: MSP packs the sensor word as ACC(0), BARO(1), MAG(2), GPS(3),
 * RANGEFINDER(4); bit 5 is firmware-specific (Betaflight: gyro; iNav: optical
 * flow) and iNav additionally reports PITOT(6). MAVLink's
 * `MAV_SYS_STATUS_SENSOR` is gyro(0), accel(1), mag(2), abs-pressure(3),
 * diff-pressure(4), gps(5), optical-flow(6), laser(8). Stuffing the raw MSP
 * word into the MAVLink-shaped sensor fields mislabels every chip.
 * @license GPL-3.0-only
 */

import type { FirmwareType } from "../types";

// MAVLink MAV_SYS_STATUS_SENSOR bit positions.
const MAV_GYRO = 1 << 0;
const MAV_ACCEL = 1 << 1;
const MAV_MAG = 1 << 2;
const MAV_ABS_PRESSURE = 1 << 3;
const MAV_DIFF_PRESSURE = 1 << 4;
const MAV_GPS = 1 << 5;
const MAV_OPTICAL_FLOW = 1 << 6;
const MAV_LASER_POSITION = 1 << 8;

// MSP sensor word bit positions (packed by the flight controller).
const MSP_ACC = 1 << 0;
const MSP_BARO = 1 << 1;
const MSP_MAG = 1 << 2;
const MSP_GPS = 1 << 3;
const MSP_RANGEFINDER = 1 << 4;
const MSP_BIT5 = 1 << 5; // Betaflight: gyro; iNav: optical flow
const MSP_INAV_PITOT = 1 << 6;

/**
 * Convert an MSP sensor bitmask to a MAVLink `MAV_SYS_STATUS_SENSOR` bitmask.
 *
 * The bit-5 (and iNav bit-6) interpretation is firmware-specific, so the
 * caller must pass the identified firmware. Any non-iNav value is treated as
 * Betaflight (gyro at bit 5), which is the correct default for the only other
 * MSP firmware the GCS drives.
 */
export function mspSensorFlagsToMavlink(
  mspFlags: number,
  firmwareType: string | null | undefined,
): number {
  let out = 0;
  if (mspFlags & MSP_ACC) out |= MAV_ACCEL;
  if (mspFlags & MSP_BARO) out |= MAV_ABS_PRESSURE;
  if (mspFlags & MSP_MAG) out |= MAV_MAG;
  if (mspFlags & MSP_GPS) out |= MAV_GPS;
  if (mspFlags & MSP_RANGEFINDER) out |= MAV_LASER_POSITION;
  if (firmwareType === "inav") {
    if (mspFlags & MSP_BIT5) out |= MAV_OPTICAL_FLOW;
    if (mspFlags & MSP_INAV_PITOT) out |= MAV_DIFF_PRESSURE;
  } else {
    if (mspFlags & MSP_BIT5) out |= MAV_GYRO;
  }
  return out;
}

/** MAVLink GPS_FIX_TYPE values the rest of the app reads fixType in. */
const GPS_FIX_TYPE_NO_FIX = 1;
const GPS_FIX_TYPE_2D = 2;
const GPS_FIX_TYPE_3D = 3;

/**
 * Translate MSP_RAW_GPS byte 0 into MAVLink GPS_FIX_TYPE.
 *
 * iNav writes gpsFixType_e (0 NO_FIX, 1 FIX_2D, 2 FIX_3D). Betaflight writes
 * STATE(GPS_FIX), the raw state bit (0 or 2), and only sets it on a valid 3D
 * fix, so any non-zero value is a 3D fix.
 */
export function mspGpsFixToMavlink(raw: number, firmwareType: FirmwareType | undefined): number {
  if (firmwareType === "inav") {
    if (raw >= 2) return GPS_FIX_TYPE_3D;
    if (raw === 1) return GPS_FIX_TYPE_2D;
    return GPS_FIX_TYPE_NO_FIX;
  }
  return raw !== 0 ? GPS_FIX_TYPE_3D : GPS_FIX_TYPE_NO_FIX;
}

/** RC_CHANNELS.rssi: 0..254 in receiver units, 255 = unknown. */
export const RC_RSSI_UNKNOWN = 255;
const RC_RSSI_MAX = 254;
/** MSP_ANALOG rssi full scale. */
const MSP_RSSI_MAX = 1023;

/**
 * Translate MSP_ANALOG's RSSI (0..1023) into the RC_CHANNELS scale. Both
 * Betaflight and iNav report 0 when no RSSI source is configured, which MSP
 * cannot tell apart from a real zero, so 0 reads as unknown rather than as a
 * dead link.
 */
export function mspRssiToRcChannels(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return RC_RSSI_UNKNOWN;
  return Math.round((Math.min(raw, MSP_RSSI_MAX) / MSP_RSSI_MAX) * RC_RSSI_MAX);
}
