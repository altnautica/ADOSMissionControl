/**
 * Navigation and safety MAVLink v2 message decoders (extended): FencePoint,
 * FenceFetchPoint, FenceStatus, Wind, Vibration, HomePosition, EkfStatusReport,
 * AdsbVehicle.
 *
 * @module protocol/messages/nav-safety-ext
 */

// ── FENCE_POINT (ID 160) ────────────────────────────────────

export interface FencePointMsg {
  lat: number;
  lon: number;
  targetSystem: number;
  targetComponent: number;
  idx: number;
  count: number;
}

/**
 * Decode FENCE_POINT (msg ID 160).
 *
 * Wire order (float32 → uint8):
 * | Offset | Type    | Field           |
 * |--------|---------|-----------------|
 * | 0      | float32 | lat             |
 * | 4      | float32 | lon             |
 * | 8      | uint8   | targetSystem    |
 * | 9      | uint8   | targetComponent |
 * | 10     | uint8   | idx             |
 * | 11     | uint8   | count           |
 */
export function decodeFencePoint(dv: DataView): FencePointMsg {
  return {
    lat: dv.getFloat32(0, true),
    lon: dv.getFloat32(4, true),
    targetSystem: dv.getUint8(8),
    targetComponent: dv.getUint8(9),
    idx: dv.getUint8(10),
    count: dv.getUint8(11),
  };
}

// ── FENCE_FETCH_POINT (ID 161) ──────────────────────────────

export interface FenceFetchPointMsg {
  targetSystem: number;
  targetComponent: number;
  idx: number;
}

/**
 * Decode FENCE_FETCH_POINT (msg ID 161).
 *
 * | Offset | Type  | Field           |
 * |--------|-------|-----------------|
 * | 0      | uint8 | targetSystem    |
 * | 1      | uint8 | targetComponent |
 * | 2      | uint8 | idx             |
 */
export function decodeFenceFetchPoint(dv: DataView): FenceFetchPointMsg {
  return {
    targetSystem: dv.getUint8(0),
    targetComponent: dv.getUint8(1),
    idx: dv.getUint8(2),
  };
}

// ── FENCE_STATUS (ID 162) ───────────────────────────────────

export interface FenceStatusMsg {
  breachTime: number;
  breachCount: number;
  breachStatus: number;
  breachType: number;
}

/**
 * Decode FENCE_STATUS (msg ID 162).
 *
 * Wire order (uint32 → uint16 → uint8):
 * | Offset | Type   | Field        |
 * |--------|--------|--------------|
 * | 0      | uint32 | breachTime   |
 * | 4      | uint16 | breachCount  |
 * | 6      | uint8  | breachStatus |
 * | 7      | uint8  | breachType   |
 */
export function decodeFenceStatus(dv: DataView): FenceStatusMsg {
  return {
    breachTime: dv.getUint32(0, true),
    breachCount: dv.getUint16(4, true),
    breachStatus: dv.getUint8(6),
    breachType: dv.getUint8(7),
  };
}

// ── WIND (ID 168) ──────────────────────────────────────────

export interface WindMsg {
  direction: number;
  speed: number;
  speedZ: number;
}

/**
 * Decode WIND (msg ID 168).
 *
 * | Offset | Type    | Field     |
 * |--------|---------|-----------|
 * | 0      | float32 | direction |
 * | 4      | float32 | speed     |
 * | 8      | float32 | speedZ    |
 */
export function decodeWind(dv: DataView): WindMsg {
  return {
    direction: dv.getFloat32(0, true),
    speed: dv.getFloat32(4, true),
    speedZ: dv.getFloat32(8, true),
  };
}

// ── VIBRATION (ID 241) ─────────────────────────────────────

export interface VibrationMsg {
  timeUsec: number;
  vibrationX: number;
  vibrationY: number;
  vibrationZ: number;
  clipping0: number;
  clipping1: number;
  clipping2: number;
}

/**
 * Decode VIBRATION (msg ID 241).
 *
 * | Offset | Type    | Field        |
 * |--------|---------|--------------|
 * | 0      | uint64  | timeUsec     |
 * | 8      | float32 | vibrationX   |
 * | 12     | float32 | vibrationY   |
 * | 16     | float32 | vibrationZ   |
 * | 20     | uint32  | clipping0    |
 * | 24     | uint32  | clipping1    |
 * | 28     | uint32  | clipping2    |
 */
export function decodeVibration(dv: DataView): VibrationMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  return {
    timeUsec: high * 0x100000000 + low,
    vibrationX: dv.getFloat32(8, true),
    vibrationY: dv.getFloat32(12, true),
    vibrationZ: dv.getFloat32(16, true),
    clipping0: dv.getUint32(20, true),
    clipping1: dv.getUint32(24, true),
    clipping2: dv.getUint32(28, true),
  };
}

// ── HOME_POSITION (ID 242) ──────────────────────────────────

export interface HomePositionMsg {
  lat: number;
  lon: number;
  alt: number;
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
  approachX: number;
  approachY: number;
  approachZ: number;
}

/**
 * Decode HOME_POSITION (msg ID 242).
 *
 * Wire order (int32/float32 → none smaller):
 * | Offset | Type       | Field       |
 * |--------|------------|-------------|
 * | 0      | int32      | lat (degE7) |
 * | 4      | int32      | lon (degE7) |
 * | 8      | int32      | alt (mm)    |
 * | 12     | float32    | x           |
 * | 16     | float32    | y           |
 * | 20     | float32    | z           |
 * | 24     | float32[4] | q           |
 * | 40     | float32    | approachX   |
 * | 44     | float32    | approachY   |
 * | 48     | float32    | approachZ   |
 */
export function decodeHomePosition(dv: DataView): HomePositionMsg {
  return {
    lat: dv.getInt32(0, true),
    lon: dv.getInt32(4, true),
    alt: dv.getInt32(8, true),
    x: dv.getFloat32(12, true),
    y: dv.getFloat32(16, true),
    z: dv.getFloat32(20, true),
    q: [
      dv.getFloat32(24, true),
      dv.getFloat32(28, true),
      dv.getFloat32(32, true),
      dv.getFloat32(36, true),
    ],
    approachX: dv.getFloat32(40, true),
    approachY: dv.getFloat32(44, true),
    approachZ: dv.getFloat32(48, true),
  };
}

// ── EKF_STATUS_REPORT (ID 193) ─────────────────────────────

export interface EkfStatusReportMsg {
  velocityVariance: number;
  posHorizVariance: number;
  posVertVariance: number;
  compassVariance: number;
  terrainAltVariance: number;
  flags: number;
}

/**
 * Decode EKF_STATUS_REPORT (msg ID 193).
 *
 * | Offset | Type    | Field                |
 * |--------|---------|----------------------|
 * | 0      | float32 | velocityVariance     |
 * | 4      | float32 | posHorizVariance     |
 * | 8      | float32 | posVertVariance      |
 * | 12     | float32 | compassVariance      |
 * | 16     | float32 | terrainAltVariance   |
 * | 20     | uint16  | flags                |
 */
export function decodeEkfStatusReport(dv: DataView): EkfStatusReportMsg {
  return {
    velocityVariance: dv.getFloat32(0, true),
    posHorizVariance: dv.getFloat32(4, true),
    posVertVariance: dv.getFloat32(8, true),
    compassVariance: dv.getFloat32(12, true),
    terrainAltVariance: dv.getFloat32(16, true),
    flags: dv.getUint16(20, true),
  };
}

// ── ADSB_VEHICLE (ID 246) ───────────────────────────────────

export interface AdsbVehicleMsg {
  icaoAddress: number;
  /** degE7 */
  lat: number;
  /** degE7 */
  lon: number;
  /** mm; the datum is `altitudeType` (0 = pressure QNH, 1 = geometric/GNSS). */
  altitude: number;
  /** cdeg */
  heading: number;
  /** cm/s */
  horVelocity: number;
  /** cm/s, positive up */
  verVelocity: number;
  /** ADSB_FLAGS bitmask: which of the fields above are valid. */
  flags: number;
  squawk: number;
  altitudeType: number;
  callsign: string;
  emitterType: number;
  /** Seconds since the receiver last heard this aircraft. */
  tslc: number;
}

/**
 * Decode ADSB_VEHICLE (msg ID 246).
 *
 * | Offset | Type     | Field        |
 * |--------|----------|--------------|
 * | 0      | uint32   | icaoAddress  |
 * | 4      | int32    | lat (degE7)  |
 * | 8      | int32    | lon (degE7)  |
 * | 12     | int32    | altitude (mm)|
 * | 16     | uint16   | heading (cdeg)|
 * | 18     | uint16   | horVelocity  |
 * | 20     | int16    | verVelocity  |
 * | 22     | uint16   | flags        |
 * | 24     | uint16   | squawk       |
 * | 26     | uint8    | altitudeType |
 * | 27     | char[9]  | callsign     |
 * | 36     | uint8    | emitterType  |
 * | 37     | uint8    | tslc         |
 */
export function decodeAdsbVehicle(dv: DataView): AdsbVehicleMsg {
  let callsign = "";
  for (let i = 0; i < 9; i++) {
    const c = dv.getUint8(27 + i);
    if (c === 0) break;
    callsign += String.fromCharCode(c);
  }
  return {
    icaoAddress: dv.getUint32(0, true),
    lat: dv.getInt32(4, true),
    lon: dv.getInt32(8, true),
    altitude: dv.getInt32(12, true),
    heading: dv.getUint16(16, true),
    horVelocity: dv.getUint16(18, true),
    verVelocity: dv.getInt16(20, true),
    flags: dv.getUint16(22, true),
    squawk: dv.getUint16(24, true),
    altitudeType: dv.getUint8(26),
    callsign: callsign.trim(),
    emitterType: dv.getUint8(36),
    tslc: dv.getUint8(37),
  };
}
