/**
 * Peripheral MAVLink v2 message decoders (extended): GimbalDeviceAttitudeStatus,
 * ObstacleDistance, MissionItem, WindCov, AisVessel, GimbalManagerInformation,
 * GimbalManagerStatus.
 *
 * @module protocol/messages/peripheral-ext
 */

// ── GIMBAL_DEVICE_ATTITUDE_STATUS (ID 284) ──────────────────

export interface GimbalDeviceAttitudeStatusMsg {
  timeBootMs: number;
  flags: number;
  q: [number, number, number, number];
  angularVelocityX: number;
  angularVelocityY: number;
  angularVelocityZ: number;
  failureFlags: number;
  targetSystem: number;
  targetComponent: number;
}

/**
 * Decode GIMBAL_DEVICE_ATTITUDE_STATUS (msg ID 284).
 *
 * Wire order (uint32/float32 → uint16 → uint8):
 * | Offset | Type       | Field            |
 * |--------|------------|------------------|
 * | 0      | uint32     | timeBootMs       |
 * | 4      | float32[4] | q                |
 * | 20     | float32    | angularVelocityX |
 * | 24     | float32    | angularVelocityY |
 * | 28     | float32    | angularVelocityZ |
 * | 32     | uint32     | failureFlags     |
 * | 36     | uint16     | flags            |
 * | 38     | uint8      | targetSystem     |
 * | 39     | uint8      | targetComponent  |
 */
export function decodeGimbalDeviceAttitudeStatus(dv: DataView): GimbalDeviceAttitudeStatusMsg {
  return {
    timeBootMs: dv.getUint32(0, true),
    q: [
      dv.getFloat32(4, true),
      dv.getFloat32(8, true),
      dv.getFloat32(12, true),
      dv.getFloat32(16, true),
    ],
    angularVelocityX: dv.getFloat32(20, true),
    angularVelocityY: dv.getFloat32(24, true),
    angularVelocityZ: dv.getFloat32(28, true),
    failureFlags: dv.getUint32(32, true),
    flags: dv.getUint16(36, true),
    targetSystem: dv.getUint8(38),
    targetComponent: dv.getUint8(39),
  };
}

// ── OBSTACLE_DISTANCE (ID 330) ──────────────────────────────

export interface ObstacleDistanceMsg {
  timeUsec: number;
  distances: number[];
  minDistance: number;
  maxDistance: number;
  sensorType: number;
  increment: number;
  /** Sector width in degrees (extension); when non-zero it replaces `increment`. */
  incrementF: number;
  /** Angle of element 0 in degrees, clockwise (extension). */
  angleOffset: number;
  /** MAV_FRAME of the angles (extension); 0 = GLOBAL, north aligned. */
  frame: number;
}

/**
 * Decode OBSTACLE_DISTANCE (msg ID 330).
 *
 * Wire order (uint64 → uint16[72] → uint16 → uint8, then the extensions in
 * declaration order):
 * | Offset | Type       | Field        |
 * |--------|------------|--------------|
 * | 0      | uint64     | timeUsec     |
 * | 8      | uint16[72] | distances    |
 * | 152    | uint16     | minDistance  |
 * | 154    | uint16     | maxDistance  |
 * | 156    | uint8      | sensorType   |
 * | 157    | uint8      | increment    |
 * | 158    | float      | incrementF   |
 * | 162    | float      | angleOffset  |
 * | 166    | uint8      | frame        |
 *
 * A sender that omits the extensions (or trims trailing zeros) reads as zero:
 * `incrementF` 0 falls back to `increment`, and frame 0 is the spec default.
 */
export function decodeObstacleDistance(dv: DataView): ObstacleDistanceMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  const distances: number[] = [];
  for (let i = 0; i < 72; i++) {
    distances.push(dv.getUint16(8 + i * 2, true));
  }
  return {
    timeUsec: high * 0x100000000 + low,
    distances,
    minDistance: dv.getUint16(152, true),
    maxDistance: dv.getUint16(154, true),
    sensorType: dv.getUint8(156),
    increment: dv.getUint8(157),
    incrementF: dv.byteLength >= 162 ? dv.getFloat32(158, true) : 0,
    angleOffset: dv.byteLength >= 166 ? dv.getFloat32(162, true) : 0,
    frame: dv.byteLength >= 167 ? dv.getUint8(166) : 0,
  };
}

// ── MISSION_ITEM (ID 39) — legacy format ─────────────────────

export interface MissionItemMsg {
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  x: number;
  y: number;
  z: number;
  seq: number;
  command: number;
  targetSystem: number;
  targetComponent: number;
  frame: number;
  current: number;
  autocontinue: number;
}

/**
 * Decode MISSION_ITEM (msg ID 39) — legacy format.
 *
 * Wire order (float32 → uint16 → uint8):
 * | Offset | Type    | Field           |
 * |--------|---------|-----------------|
 * | 0      | float32 | param1          |
 * | 4      | float32 | param2          |
 * | 8      | float32 | param3          |
 * | 12     | float32 | param4          |
 * | 16     | float32 | x               |
 * | 20     | float32 | y               |
 * | 24     | float32 | z               |
 * | 28     | uint16  | seq             |
 * | 30     | uint16  | command         |
 * | 32     | uint8   | targetSystem    |
 * | 33     | uint8   | targetComponent |
 * | 34     | uint8   | frame           |
 * | 35     | uint8   | current         |
 * | 36     | uint8   | autocontinue    |
 */
export function decodeMissionItem(dv: DataView): MissionItemMsg {
  return {
    param1: dv.getFloat32(0, true),
    param2: dv.getFloat32(4, true),
    param3: dv.getFloat32(8, true),
    param4: dv.getFloat32(12, true),
    x: dv.getFloat32(16, true),
    y: dv.getFloat32(20, true),
    z: dv.getFloat32(24, true),
    seq: dv.getUint16(28, true),
    command: dv.getUint16(30, true),
    targetSystem: dv.getUint8(32),
    targetComponent: dv.getUint8(33),
    frame: dv.getUint8(34),
    current: dv.getUint8(35),
    autocontinue: dv.getUint8(36),
  };
}

// ── WIND_COV (ID 231) ────────────────────────────────────────

export interface WindCovMsg {
  timeUsec: number;
  windX: number;
  windY: number;
  windZ: number;
  varHoriz: number;
  varVert: number;
  windAlt: number;
  horizAccuracy: number;
  vertAccuracy: number;
}

/**
 * Decode WIND_COV (msg ID 231).
 *
 * Wire order (uint64 → float32):
 * | Offset | Type    | Field          |
 * |--------|---------|----------------|
 * | 0      | uint64  | timeUsec       |
 * | 8      | float32 | windX          |
 * | 12     | float32 | windY          |
 * | 16     | float32 | windZ          |
 * | 20     | float32 | varHoriz       |
 * | 24     | float32 | varVert        |
 * | 28     | float32 | windAlt        |
 * | 32     | float32 | horizAccuracy  |
 * | 36     | float32 | vertAccuracy   |
 */
export function decodeWindCov(dv: DataView): WindCovMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  return {
    timeUsec: high * 0x100000000 + low,
    windX: dv.getFloat32(8, true),
    windY: dv.getFloat32(12, true),
    windZ: dv.getFloat32(16, true),
    varHoriz: dv.getFloat32(20, true),
    varVert: dv.getFloat32(24, true),
    windAlt: dv.getFloat32(28, true),
    horizAccuracy: dv.getFloat32(32, true),
    vertAccuracy: dv.getFloat32(36, true),
  };
}

// ── AIS_VESSEL (ID 246) ──────────────────────────────────────

export interface AisVesselMsg {
  MMSI: number;
  lat: number;
  lon: number;
  COG: number;
  heading: number;
  velocity: number;
  dimensionBow: number;
  dimensionStern: number;
  tslc: number;
  flags: number;
  turnRate: number;
  navigationalStatus: number;
  type: number;
  dimensionPort: number;
  dimensionStarboard: number;
  callsign: string;
  name: string;
}

/**
 * Decode AIS_VESSEL (msg ID 246).
 *
 * Wire order (uint32/int32 → uint16 → int8/uint8 → char):
 * | Offset | Type    | Field              |
 * |--------|---------|---------------------|
 * | 0      | uint32  | MMSI               |
 * | 4      | int32   | lat (degE7)        |
 * | 8      | int32   | lon (degE7)        |
 * | 12     | uint16  | COG (cdeg)         |
 * | 14     | uint16  | heading (cdeg)     |
 * | 16     | uint16  | velocity (cm/s)    |
 * | 18     | uint16  | dimensionBow       |
 * | 20     | uint16  | dimensionStern     |
 * | 22     | uint16  | tslc               |
 * | 24     | uint16  | flags              |
 * | 26     | int8    | turnRate           |
 * | 27     | uint8   | navigationalStatus |
 * | 28     | uint8   | type               |
 * | 29     | uint8   | dimensionPort      |
 * | 30     | uint8   | dimensionStarboard |
 * | 31     | char[7] | callsign           |
 * | 38     | char[20]| name               |
 */
export function decodeAisVessel(dv: DataView): AisVesselMsg {
  // callsign: 7 bytes at offset 31
  const csBytes = new Uint8Array(dv.buffer, dv.byteOffset + 31, 7);
  let callsign = "";
  for (let i = 0; i < 7; i++) {
    if (csBytes[i] === 0) break;
    callsign += String.fromCharCode(csBytes[i]);
  }
  // name: 20 bytes at offset 38
  const nmBytes = new Uint8Array(dv.buffer, dv.byteOffset + 38, 20);
  let name = "";
  for (let i = 0; i < 20; i++) {
    if (nmBytes[i] === 0) break;
    name += String.fromCharCode(nmBytes[i]);
  }
  return {
    MMSI: dv.getUint32(0, true),
    lat: dv.getInt32(4, true),
    lon: dv.getInt32(8, true),
    COG: dv.getUint16(12, true),
    heading: dv.getUint16(14, true),
    velocity: dv.getUint16(16, true),
    dimensionBow: dv.getUint16(18, true),
    dimensionStern: dv.getUint16(20, true),
    tslc: dv.getUint16(22, true),
    flags: dv.getUint16(24, true),
    turnRate: dv.getInt8(26),
    navigationalStatus: dv.getUint8(27),
    type: dv.getUint8(28),
    dimensionPort: dv.getUint8(29),
    dimensionStarboard: dv.getUint8(30),
    callsign,
    name,
  };
}

// ── GIMBAL_MANAGER_INFORMATION (ID 285) ──────────────────────

export interface GimbalManagerInformationMsg {
  timeBootMs: number;
  capFlags: number;
  gimbalDeviceId: number;
  rollMin: number;
  rollMax: number;
  pitchMin: number;
  pitchMax: number;
  yawMin: number;
  yawMax: number;
}

/**
 * Decode GIMBAL_MANAGER_INFORMATION (msg ID 285).
 *
 * Wire order (uint32 → float32 → uint8):
 * | Offset | Type    | Field          |
 * |--------|---------|----------------|
 * | 0      | uint32  | timeBootMs     |
 * | 4      | uint32  | capFlags       |
 * | 8      | float32 | rollMin (rad)  |
 * | 12     | float32 | rollMax (rad)  |
 * | 16     | float32 | pitchMin (rad) |
 * | 20     | float32 | pitchMax (rad) |
 * | 24     | float32 | yawMin (rad)   |
 * | 28     | float32 | yawMax (rad)   |
 * | 32     | uint8   | gimbalDeviceId |
 */
export function decodeGimbalManagerInformation(dv: DataView): GimbalManagerInformationMsg {
  return {
    timeBootMs: dv.getUint32(0, true),
    capFlags: dv.getUint32(4, true),
    rollMin: dv.getFloat32(8, true),
    rollMax: dv.getFloat32(12, true),
    pitchMin: dv.getFloat32(16, true),
    pitchMax: dv.getFloat32(20, true),
    yawMin: dv.getFloat32(24, true),
    yawMax: dv.getFloat32(28, true),
    gimbalDeviceId: dv.getUint8(32),
  };
}

// ── GIMBAL_MANAGER_STATUS (ID 286) ───────────────────────────

export interface GimbalManagerStatusMsg {
  timeBootMs: number;
  flags: number;
  gimbalDeviceId: number;
  primaryControlSysid: number;
  primaryControlCompid: number;
  secondaryControlSysid: number;
  secondaryControlCompid: number;
}

/**
 * Decode GIMBAL_MANAGER_STATUS (msg ID 286).
 *
 * Wire order (uint32 → uint8):
 * | Offset | Type   | Field                  |
 * |--------|--------|------------------------|
 * | 0      | uint32 | timeBootMs             |
 * | 4      | uint32 | flags                  |
 * | 8      | uint8  | gimbalDeviceId         |
 * | 9      | uint8  | primaryControlSysid    |
 * | 10     | uint8  | primaryControlCompid   |
 * | 11     | uint8  | secondaryControlSysid  |
 * | 12     | uint8  | secondaryControlCompid |
 */
export function decodeGimbalManagerStatus(dv: DataView): GimbalManagerStatusMsg {
  return {
    timeBootMs: dv.getUint32(0, true),
    flags: dv.getUint32(4, true),
    gimbalDeviceId: dv.getUint8(8),
    primaryControlSysid: dv.getUint8(9),
    primaryControlCompid: dv.getUint8(10),
    secondaryControlSysid: dv.getUint8(11),
    secondaryControlCompid: dv.getUint8(12),
  };
}
