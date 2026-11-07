/**
 * Mission protocol MAVLink v2 message decoders: MissionAck, MissionRequestInt,
 * MissionCount, MissionItemInt, MissionCurrent, MissionItemReached.
 *
 * @module protocol/messages/mission
 */

// ── MISSION_ACK (ID 47) ────────────────────────────────────

export interface MissionAckMsg {
  targetSystem: number;
  targetComponent: number;
  type: number;
  missionType: number;
  /** v2 extension: the plan identity the vehicle assigned (0 = not set). */
  opaqueId: number;
}

/**
 * Decode MISSION_ACK (msg ID 47).
 *
 * | Offset | Type  | Field           |
 * |--------|-------|-----------------|
 * | 0      | uint8 | targetSystem    |
 * | 1      | uint8 | targetComponent |
 * | 2      | uint8 | type            |
 * | 3      | uint8 | missionType     | (v2 extension, optional)
 * | 4      | uint32| opaqueId        | (v2 extension, optional)
 */
export function decodeMissionAck(dv: DataView): MissionAckMsg {
  return {
    targetSystem: dv.getUint8(0),
    targetComponent: dv.getUint8(1),
    type: dv.getUint8(2),
    missionType: dv.byteLength > 3 ? dv.getUint8(3) : 0,
    opaqueId: dv.byteLength >= 8 ? dv.getUint32(4, true) : 0,
  };
}

// ── MISSION_COUNT (ID 44) ──────────────────────────────────

export interface MissionCountMsg {
  count: number;
  targetSystem: number;
  targetComponent: number;
  missionType: number;
}

/**
 * Decode MISSION_COUNT (msg ID 44).
 *
 * | Offset | Type   | Field           |
 * |--------|--------|-----------------|
 * | 0      | uint16 | count           |
 * | 2      | uint8  | targetSystem    |
 * | 3      | uint8  | targetComponent |
 * | 4      | uint8  | missionType     | (v2 extension, optional)
 */
export function decodeMissionCount(dv: DataView): MissionCountMsg {
  return {
    count: dv.getUint16(0, true),
    targetSystem: dv.getUint8(2),
    targetComponent: dv.getUint8(3),
    missionType: dv.byteLength > 4 ? dv.getUint8(4) : 0,
  };
}

// ── MISSION_CURRENT (ID 42) ────────────────────────────────

export interface MissionCurrentMsg {
  seq: number;
  /** Extension fields; undefined when the payload ends before them. */
  total?: number;
  missionState?: number;
  missionMode?: number;
  missionId?: number;
}

/**
 * Decode MISSION_CURRENT (msg ID 42), base field plus the extensions in
 * declared order (MAVLink v2 truncates trailing zero bytes, so a short
 * payload past `seq` reads its missing bytes as zero).
 *
 * | Offset | Type   | Field          |
 * |--------|--------|----------------|
 * | 0      | uint16 | seq            |
 * | 2      | uint16 | total          |
 * | 4      | uint8  | mission_state  |
 * | 5      | uint8  | mission_mode   |
 * | 6      | uint32 | mission_id     |
 */
export function decodeMissionCurrent(dv: DataView): MissionCurrentMsg {
  const len = dv.byteLength;
  const u8 = (o: number): number => (o < len ? dv.getUint8(o) : 0);
  const msg: MissionCurrentMsg = { seq: u8(0) | (u8(1) << 8) };
  if (len > 2) {
    msg.total = u8(2) | (u8(3) << 8);
    msg.missionState = u8(4);
    msg.missionMode = u8(5);
    msg.missionId = (u8(6) | (u8(7) << 8) | (u8(8) << 16) | (u8(9) << 24)) >>> 0;
  }
  return msg;
}

// ── MISSION_ITEM_REACHED (ID 46) ───────────────────────────

export interface MissionItemReachedMsg {
  seq: number;
}

/**
 * Decode MISSION_ITEM_REACHED (msg ID 46).
 *
 * | Offset | Type   | Field |
 * |--------|--------|-------|
 * | 0      | uint16 | seq   |
 */
export function decodeMissionItemReached(dv: DataView): MissionItemReachedMsg {
  return {
    seq: dv.getUint16(0, true),
  };
}

// ── MISSION_REQUEST_INT (ID 51) ─────────────────────────────

export interface MissionRequestIntMsg {
  targetSystem: number;
  targetComponent: number;
  seq: number;
  missionType: number;
}

/**
 * Decode MISSION_REQUEST_INT (msg ID 51).
 *
 * | Offset | Type   | Field           |
 * |--------|--------|-----------------|
 * | 0      | uint16 | seq             |
 * | 2      | uint8  | targetSystem    |
 * | 3      | uint8  | targetComponent |
 * | 4      | uint8  | missionType     | (v2 extension, optional)
 */
export function decodeMissionRequestInt(dv: DataView): MissionRequestIntMsg {
  return {
    seq: dv.getUint16(0, true),
    targetSystem: dv.getUint8(2),
    targetComponent: dv.getUint8(3),
    missionType: dv.byteLength > 4 ? dv.getUint8(4) : 0,
  };
}

// ── MISSION_ITEM_INT (ID 73) — Decode ─────────────────────

export interface MissionItemIntMsg {
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
  missionType: number;
}

/**
 * Decode MISSION_ITEM_INT (msg ID 73).
 *
 * | Offset | Type    | Field           |
 * |--------|---------|-----------------|
 * | 0      | float32 | param1          |
 * | 4      | float32 | param2          |
 * | 8      | float32 | param3          |
 * | 12     | float32 | param4          |
 * | 16     | int32   | x (lat * 1e7)   |
 * | 20     | int32   | y (lon * 1e7)   |
 * | 24     | float32 | z (alt)         |
 * | 28     | uint16  | seq             |
 * | 30     | uint16  | command         |
 * | 32     | uint8   | targetSystem    |
 * | 33     | uint8   | targetComponent |
 * | 34     | uint8   | frame           |
 * | 35     | uint8   | current         |
 * | 36     | uint8   | autocontinue    |
 * | 37     | uint8   | missionType     | (v2 extension, optional)
 */
export function decodeMissionItemInt(dv: DataView): MissionItemIntMsg {
  return {
    param1: dv.getFloat32(0, true),
    param2: dv.getFloat32(4, true),
    param3: dv.getFloat32(8, true),
    param4: dv.getFloat32(12, true),
    x: dv.getInt32(16, true),
    y: dv.getInt32(20, true),
    z: dv.getFloat32(24, true),
    seq: dv.getUint16(28, true),
    command: dv.getUint16(30, true),
    targetSystem: dv.getUint8(32),
    targetComponent: dv.getUint8(33),
    frame: dv.getUint8(34),
    current: dv.getUint8(35),
    autocontinue: dv.getUint8(36),
    missionType: dv.byteLength > 37 ? dv.getUint8(37) : 0,
  };
}
