/**
 * @module gnss-fix2
 * @description Codec for `uavcan.equipment.gnss.Fix2` (data type id 1063).
 *
 * Wire layout (bit stream in the DroneCAN scalar layout described in
 * `bit-buffer.ts`):
 *   uavcan.Timestamp   timestamp                  (uint56)
 *   uavcan.Timestamp   gnss_timestamp             (uint56)
 *   uint3              gnss_time_standard
 *   void13             (reserved)
 *   uint8              num_leap_seconds
 *   int37              longitude_deg_1e8
 *   int37              latitude_deg_1e8
 *   int27              height_ellipsoid_mm
 *   int27              height_msl_mm
 *   float32[3]         ned_velocity
 *   uint6              sats_used
 *   uint2              status
 *   uint4              mode
 *   uint6              sub_mode
 *   float16[<=36]      covariance (uint6 length prefix; this array is not last)
 *   float16            pdop
 *   ECEFPositionVelocity[<=1] ecef_position_velocity (last field; TAO drops the 1-bit length prefix)
 *
 * ECEFPositionVelocity nested type:
 *   float32[3]         velocity_xyz
 *   int36[3]           position_xyz_mm
 *   void6              (alignment)
 *   float16[<=36]      covariance (uint6 length prefix: elements of a
 *                      tail-optimized composite array are encoded without
 *                      the optimization, so this inner array keeps its prefix)
 *
 * The GCS subscribes to `Fix2` broadcasts; the encoder feeds the demo CAN
 * bus and the tests.
 *
 * @license GPL-3.0-only
 */

import { BitReader, BitWriter } from "../bit-buffer";
import {
  decodeTimestamp,
  encodeTimestamp,
  type Timestamp,
} from "./timestamp";

export const GNSS_TIME_STANDARD_NONE = 0;
export const GNSS_TIME_STANDARD_TAI = 1;
export const GNSS_TIME_STANDARD_UTC = 2;
export const GNSS_TIME_STANDARD_GPS = 3;
export type GnssTimeStandard = 0 | 1 | 2 | 3;

export const STATUS_NO_FIX = 0;
export const STATUS_TIME_ONLY = 1;
export const STATUS_2D_FIX = 2;
export const STATUS_3D_FIX = 3;
export type FixStatus = 0 | 1 | 2 | 3;

export const MODE_SINGLE = 0;
export const MODE_DGPS = 1;
export const MODE_RTK = 2;
export const MODE_PPP = 3;

/** Maximum number of `float16` entries in either covariance array. */
export const FIX2_COVARIANCE_MAX = 36;

export interface EcefPositionVelocity {
  velocityXyz: [number, number, number];
  positionXyzMm: [bigint, bigint, bigint];
  covariance: number[];
}

export interface GnssFix2 {
  timestamp: Timestamp;
  gnssTimestamp: Timestamp;
  gnssTimeStandard: GnssTimeStandard;
  numLeapSeconds: number;
  longitudeDeg1e8: bigint;
  latitudeDeg1e8: bigint;
  heightEllipsoidMm: number;
  heightMslMm: number;
  nedVelocity: [number, number, number];
  satsUsed: number;
  status: FixStatus;
  mode: number;
  subMode: number;
  covariance: number[];
  pdop: number;
  ecefPositionVelocity?: EcefPositionVelocity;
}

/** Decode a `Fix2` broadcast payload from the wire bytes. */
export function decodeFix2(buf: Uint8Array): GnssFix2 {
  const r = new BitReader(buf);

  const timestamp = decodeTimestamp(r);
  const gnssTimestamp = decodeTimestamp(r);
  const gnssTimeStandard = r.read(3) as GnssTimeStandard;
  r.skip(13); // reserved
  const numLeapSeconds = r.read(8);
  const longitudeDeg1e8 = r.readBig(37, true);
  const latitudeDeg1e8 = r.readBig(37, true);
  const heightEllipsoidMm = r.read(27, true);
  const heightMslMm = r.read(27, true);
  const nedVelocity: [number, number, number] = [
    r.readFloat32(),
    r.readFloat32(),
    r.readFloat32(),
  ];
  const satsUsed = r.read(6);
  const status = r.read(2) as FixStatus;
  const mode = r.read(4);
  const subMode = r.read(6);

  const covCount = Math.min(r.read(6), FIX2_COVARIANCE_MAX);
  const covariance: number[] = [];
  for (let i = 0; i < covCount; i++) covariance.push(r.readFloat16());

  const pdop = r.readFloat16();

  // ecef_position_velocity is the last field of Fix2 with element type
  // ECEFPositionVelocity (composite, >=8 bits per element), so the
  // tail-array optimization (TAO) elides the 1-bit length prefix. If
  // enough bits remain for a nested ECEFPositionVelocity, decode one;
  // otherwise the broadcast carried no ECEF block.
  //
  // Inside ECEFPositionVelocity: velocity_xyz is float32[3] (96 bits),
  // position_xyz_mm is int36[3] (108 bits), then void6, then the
  // covariance count (uint6) and that many float16 entries. The element is
  // encoded without TAO, so the count is on the wire.
  let ecefPositionVelocity: EcefPositionVelocity | undefined;
  const ECEF_HEADER_BITS = 96 + 108 + 6 + 6; // velocity + position + void6 + count
  if (r.remaining() >= ECEF_HEADER_BITS) {
    const vx = r.readFloat32();
    const vy = r.readFloat32();
    const vz = r.readFloat32();
    const px = r.readBig(36, true);
    const py = r.readBig(36, true);
    const pz = r.readBig(36, true);
    r.skip(6); // void6 alignment pad
    const innerCount = Math.min(r.read(6), FIX2_COVARIANCE_MAX);
    const innerCov: number[] = [];
    for (let i = 0; i < innerCount; i++) innerCov.push(r.readFloat16());
    ecefPositionVelocity = {
      velocityXyz: [vx, vy, vz],
      positionXyzMm: [px, py, pz],
      covariance: innerCov,
    };
  }

  return {
    timestamp,
    gnssTimestamp,
    gnssTimeStandard,
    numLeapSeconds,
    longitudeDeg1e8,
    latitudeDeg1e8,
    heightEllipsoidMm,
    heightMslMm,
    nedVelocity,
    satsUsed,
    status,
    mode,
    subMode,
    covariance,
    pdop,
    ecefPositionVelocity,
  };
}

/** Encode a `Fix2` broadcast payload. Used by the demo CAN bus and tests. */
export function encodeFix2(msg: GnssFix2): Uint8Array {
  if (msg.covariance.length > FIX2_COVARIANCE_MAX) {
    throw new RangeError(
      `Fix2.covariance has ${msg.covariance.length} entries; max ${FIX2_COVARIANCE_MAX}`,
    );
  }
  const w = new BitWriter();
  encodeTimestamp(w, msg.timestamp);
  encodeTimestamp(w, msg.gnssTimestamp);
  w.write(msg.gnssTimeStandard & 0x7, 3);
  w.write(0, 13); // reserved
  w.write(msg.numLeapSeconds & 0xff, 8);
  w.writeBig(msg.longitudeDeg1e8, 37);
  w.writeBig(msg.latitudeDeg1e8, 37);
  w.write(msg.heightEllipsoidMm | 0, 27);
  w.write(msg.heightMslMm | 0, 27);
  for (const v of msg.nedVelocity) w.writeFloat32(v);
  w.write(msg.satsUsed & 0x3f, 6);
  w.write(msg.status & 0x3, 2);
  w.write(msg.mode & 0xf, 4);
  w.write(msg.subMode & 0x3f, 6);
  w.write(msg.covariance.length & 0x3f, 6);
  for (const v of msg.covariance) w.writeFloat16(v);
  w.writeFloat16(msg.pdop);

  // ecef_position_velocity is the last field with composite element type,
  // so TAO drops the outer length prefix. We emit either the full
  // ECEFPositionVelocity block or nothing. The element itself is encoded
  // without TAO, so its covariance array keeps its uint6 length prefix.
  const ecef = msg.ecefPositionVelocity;
  if (ecef) {
    if (ecef.covariance.length > FIX2_COVARIANCE_MAX) {
      throw new RangeError(
        `ecef.covariance has ${ecef.covariance.length} entries; max ${FIX2_COVARIANCE_MAX}`,
      );
    }
    for (const v of ecef.velocityXyz) w.writeFloat32(v);
    for (const p of ecef.positionXyzMm) w.writeBig(p, 36);
    w.write(0, 6); // void6 alignment pad
    w.write(ecef.covariance.length, 6);
    for (const v of ecef.covariance) w.writeFloat16(v);
  }
  return w.toUint8Array();
}
