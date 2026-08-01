/**
 * Peripheral MAVLink v2 message decoders: SerialControl, Debug, NamedValue,
 * Camera, Gimbal, Obstacle, LogEntry, LogData, Gps2Raw.
 *
 * @module protocol/messages/peripheral
 */

// ── SERIAL_CONTROL (ID 126) ─────────────────────────────────

export interface SerialControlMsg {
  baudrate: number;
  timeout: number;
  device: number;
  flags: number;
  count: number;
  data: Uint8Array;
}

/**
 * Decode SERIAL_CONTROL (msg ID 126).
 *
 * | Offset | Type      | Field    |
 * |--------|-----------|----------|
 * | 0      | uint32    | baudrate |
 * | 4      | uint16    | timeout  |
 * | 6      | uint8     | device   |
 * | 7      | uint8     | flags    |
 * | 8      | uint8     | count    |
 * | 9      | uint8[70] | data     |
 */
export function decodeSerialControl(dv: DataView): SerialControlMsg {
  const count = dv.getUint8(8);
  const data = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = dv.getUint8(9 + i);
  }
  return {
    baudrate: dv.getUint32(0, true),
    timeout: dv.getUint16(4, true),
    device: dv.getUint8(6),
    flags: dv.getUint8(7),
    count,
    data,
  };
}

// ── LOG_ENTRY (ID 118) ──────────────────────────────────────

export interface LogEntryMsg {
  id: number;
  numLogs: number;
  lastLogNum: number;
  timeUtc: number;
  size: number;
}

/**
 * Decode LOG_ENTRY (msg ID 118).
 *
 * Wire order (uint32 → uint16):
 * | Offset | Type   | Field      |
 * |--------|--------|------------|
 * | 0      | uint32 | timeUtc    |
 * | 4      | uint32 | size       |
 * | 8      | uint16 | id         |
 * | 10     | uint16 | numLogs    |
 * | 12     | uint16 | lastLogNum |
 */
export function decodeLogEntry(dv: DataView): LogEntryMsg {
  return {
    timeUtc: dv.getUint32(0, true),
    size: dv.getUint32(4, true),
    id: dv.getUint16(8, true),
    numLogs: dv.getUint16(10, true),
    lastLogNum: dv.getUint16(12, true),
  };
}

// ── LOG_DATA (ID 120) ───────────────────────────────────────

export interface LogDataMsg {
  ofs: number;
  id: number;
  count: number;
  data: Uint8Array;
}

/**
 * Decode LOG_DATA (msg ID 120).
 *
 * Wire order (uint32 → uint16 → uint8):
 * | Offset | Type      | Field |
 * |--------|-----------|-------|
 * | 0      | uint32    | ofs   |
 * | 4      | uint16    | id    |
 * | 6      | uint8     | count |
 * | 7      | uint8[90] | data  |
 */
export function decodeLogData(dv: DataView): LogDataMsg {
  const count = dv.getUint8(6);
  const data = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = dv.getUint8(7 + i);
  }
  return {
    ofs: dv.getUint32(0, true),
    id: dv.getUint16(4, true),
    count,
    data,
  };
}

// ── GPS2_RAW (ID 124) ──────────────────────────────────────

export interface Gps2RawMsg {
  timeUsec: number;
  lat: number;
  lon: number;
  alt: number;
  dgpsAge: number;
  eph: number;
  epv: number;
  vel: number;
  cog: number;
  fixType: number;
  satellitesVisible: number;
  dgpsNumch: number;
}

/**
 * Decode GPS2_RAW (msg ID 124).
 *
 * Wire order (uint64 → int32 → uint32 → uint16 → uint8):
 * | Offset | Type   | Field             |
 * |--------|--------|-------------------|
 * | 0      | uint64 | timeUsec          |
 * | 8      | int32  | lat (degE7)       |
 * | 12     | int32  | lon (degE7)       |
 * | 16     | int32  | alt (mm MSL)      |
 * | 20     | uint32 | dgpsAge           |
 * | 24     | uint16 | eph (cm)          |
 * | 26     | uint16 | epv (cm)          |
 * | 28     | uint16 | vel (cm/s)        |
 * | 30     | uint16 | cog (cdeg)        |
 * | 32     | uint8  | fixType           |
 * | 33     | uint8  | satellitesVisible |
 * | 34     | uint8  | dgpsNumch         |
 */
export function decodeGps2Raw(dv: DataView): Gps2RawMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  return {
    timeUsec: high * 0x100000000 + low,
    lat: dv.getInt32(8, true),
    lon: dv.getInt32(12, true),
    alt: dv.getInt32(16, true),
    dgpsAge: dv.getUint32(20, true),
    eph: dv.getUint16(24, true),
    epv: dv.getUint16(26, true),
    vel: dv.getUint16(28, true),
    cog: dv.getUint16(30, true),
    fixType: dv.getUint8(32),
    satellitesVisible: dv.getUint8(33),
    dgpsNumch: dv.getUint8(34),
  };
}

// ── CAMERA_TRIGGER (ID 112) ──────────────────────────────────

export interface CameraTriggerMsg {
  timeUsec: number;
  seq: number;
  lat: number;
  lon: number;
  alt: number;
}

/**
 * Decode CAMERA_TRIGGER (msg ID 112).
 *
 * Wire order (uint64 → uint32 → int32 → float32):
 * | Offset | Type    | Field          |
 * |--------|---------|----------------|
 * | 0      | uint64  | timeUsec       |
 * | 8      | uint32  | seq            |
 * | 12     | int32   | lat (degE7)    |
 * | 16     | int32   | lon (degE7)    |
 * | 20     | float32 | alt (m, AMSL)  |
 */
export function decodeCameraTrigger(dv: DataView): CameraTriggerMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  return {
    timeUsec: high * 0x100000000 + low,
    seq: dv.getUint32(8, true),
    lat: dv.getInt32(12, true),
    lon: dv.getInt32(16, true),
    alt: dv.getFloat32(20, true),
  };
}

// ── NAMED_VALUE_FLOAT (ID 251) ──────────────────────────────

export interface NamedValueFloatMsg {
  timeBootMs: number;
  value: number;
  name: string;
}

/**
 * Decode NAMED_VALUE_FLOAT (msg ID 251).
 *
 * Wire order (uint32/float32 → char[10]):
 * | Offset | Type      | Field      |
 * |--------|-----------|------------|
 * | 0      | uint32    | timeBootMs |
 * | 4      | float32   | value      |
 * | 8      | char[10]  | name       |
 */
export function decodeNamedValueFloat(dv: DataView): NamedValueFloatMsg {
  const nameBytes = new Uint8Array(dv.buffer, dv.byteOffset + 8, 10);
  let name = "";
  for (let i = 0; i < 10; i++) {
    if (nameBytes[i] === 0) break;
    name += String.fromCharCode(nameBytes[i]);
  }
  return {
    timeBootMs: dv.getUint32(0, true),
    value: dv.getFloat32(4, true),
    name,
  };
}

// ── NAMED_VALUE_INT (ID 252) ────────────────────────────────

export interface NamedValueIntMsg {
  timeBootMs: number;
  value: number;
  name: string;
}

/**
 * Decode NAMED_VALUE_INT (msg ID 252).
 *
 * Wire order (uint32/int32 → char[10]):
 * | Offset | Type     | Field      |
 * |--------|----------|------------|
 * | 0      | uint32   | timeBootMs |
 * | 4      | int32    | value      |
 * | 8      | char[10] | name       |
 */
export function decodeNamedValueInt(dv: DataView): NamedValueIntMsg {
  const nameBytes = new Uint8Array(dv.buffer, dv.byteOffset + 8, 10);
  let name = "";
  for (let i = 0; i < 10; i++) {
    if (nameBytes[i] === 0) break;
    name += String.fromCharCode(nameBytes[i]);
  }
  return {
    timeBootMs: dv.getUint32(0, true),
    value: dv.getInt32(4, true),
    name,
  };
}

// ── DEBUG (ID 254) ──────────────────────────────────────────

export interface DebugMsg {
  timeBootMs: number;
  value: number;
  ind: number;
}

/**
 * Decode DEBUG (msg ID 254).
 *
 * Wire order (uint32/float32 → uint8):
 * | Offset | Type    | Field      |
 * |--------|---------|------------|
 * | 0      | uint32  | timeBootMs |
 * | 4      | float32 | value      |
 * | 8      | uint8   | ind        |
 */
export function decodeDebug(dv: DataView): DebugMsg {
  return {
    timeBootMs: dv.getUint32(0, true),
    value: dv.getFloat32(4, true),
    ind: dv.getUint8(8),
  };
}

// ── CAMERA_IMAGE_CAPTURED (ID 263) ──────────────────────────

export interface CameraImageCapturedMsg {
  timeBootMs: number;
  timeUtcUs: number;
  lat: number;
  lon: number;
  alt: number;
  relativeAlt: number;
  q: [number, number, number, number];
  imageIndex: number;
  cameraId: number;
  captureResult: number;
  fileUrl: string;
}

/**
 * Decode CAMERA_IMAGE_CAPTURED (msg ID 263).
 *
 * Wire order (uint64/uint32/int32/float32 → int32 → uint8):
 * | Offset | Type       | Field         |
 * |--------|------------|---------------|
 * | 0      | uint64     | timeUtcUs     |
 * | 8      | float32[4] | q             |
 * | 24     | int32      | lat (degE7)   |
 * | 28     | int32      | lon (degE7)   |
 * | 32     | int32      | alt (mm)      |
 * | 36     | int32      | relativeAlt   |
 * | 40     | uint32     | timeBootMs    |
 * | 44     | int32      | imageIndex    |
 * | 48     | uint8      | cameraId      |
 * | 49     | int8       | captureResult |
 * | 50     | char[205]  | fileUrl       |
 */
export function decodeCameraImageCaptured(dv: DataView): CameraImageCapturedMsg {
  const low = dv.getUint32(0, true);
  const high = dv.getUint32(4, true);
  // fileUrl: UTF-8, up to 205 bytes null-terminated, starting at offset 50.
  const urlEnd = Math.min(50 + 205, dv.byteLength);
  let urlLen = 0;
  while (50 + urlLen < urlEnd && dv.getUint8(50 + urlLen) !== 0) urlLen++;
  const urlBytes = new Uint8Array(dv.buffer, dv.byteOffset + 50, urlLen);
  return {
    timeUtcUs: high * 0x100000000 + low,
    q: [
      dv.getFloat32(8, true),
      dv.getFloat32(12, true),
      dv.getFloat32(16, true),
      dv.getFloat32(20, true),
    ],
    lat: dv.getInt32(24, true) / 1e7,
    lon: dv.getInt32(28, true) / 1e7,
    alt: dv.getInt32(32, true) / 1000,
    relativeAlt: dv.getInt32(36, true) / 1000,
    timeBootMs: dv.getUint32(40, true),
    imageIndex: dv.getInt32(44, true),
    cameraId: dv.getUint8(48),
    captureResult: dv.getInt8(49),
    fileUrl: new TextDecoder("utf-8").decode(urlBytes),
  };
}

