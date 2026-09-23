/**
 * MAVLink peripheral encoders: SerialControl, Log*, FencePoint.
 * @module protocol/encoders/peripheral
 */

import { buildFrame } from "./frame";

// ── SERIAL_CONTROL (ID 126) ────────────────────────────────

/**
 * Encode a SERIAL_CONTROL message for serial passthrough to the FC shell.
 *
 * @param device   - SERIAL_CONTROL_DEV enum (0 = TELEM1, 10 = SHELL)
 * @param flags    - SERIAL_CONTROL_FLAG bitmask (REPLY=1, RESPOND=2, EXCLUSIVE=4, BLOCKING=8, MULTI=16)
 * @param timeout  - Timeout in ms (0 = no timeout)
 * @param baudrate - Baudrate (0 = no change)
 * @param data     - Payload bytes (max 70)
 */
export function encodeSerialControl(
  device: number,
  flags: number,
  timeout: number,
  baudrate: number,
  data: Uint8Array,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(79);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, baudrate, true);   // baudrate
  dv.setUint16(4, timeout, true);    // timeout
  payload[6] = device;               // device
  payload[7] = flags;                // flags
  payload[8] = Math.min(data.length, 70); // count
  payload.set(data.subarray(0, 70), 9);   // data[70]
  return buildFrame(126, payload, sysId, compId);
}

// ── LOG_REQUEST_LIST (ID 117) ────────────────────────────────

/**
 * Request a list of available on-board logs.
 * @param start - First log id (0 for first available)
 * @param end   - Last log id (0xFFFF for last available)
 */
export function encodeLogRequestList(
  targetSys: number,
  targetComp: number,
  start = 0,
  end = 0xffff,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(6);
  const dv = new DataView(payload.buffer);
  // Wire order: uint16 start, uint16 end, uint8 target_system, uint8 target_component
  dv.setUint16(0, start, true);
  dv.setUint16(2, end, true);
  payload[4] = targetSys;
  payload[5] = targetComp;
  return buildFrame(117, payload, sysId, compId);
}

// ── LOG_REQUEST_DATA (ID 119) ───────────────────────────────

/**
 * Request a chunk of a log.
 * @param logId - Log id from LOG_ENTRY
 * @param ofs   - Byte offset into the log
 * @param count - Number of bytes (0xFFFFFFFF for all remaining)
 */
export function encodeLogRequestData(
  targetSys: number,
  targetComp: number,
  logId: number,
  ofs: number,
  count = 0xffffffff,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(12);
  const dv = new DataView(payload.buffer);
  // Wire order: uint32 ofs, uint32 count, uint16 id, uint8 target_system, uint8 target_component
  dv.setUint32(0, ofs, true);
  dv.setUint32(4, count, true);
  dv.setUint16(8, logId, true);
  payload[10] = targetSys;
  payload[11] = targetComp;
  return buildFrame(119, payload, sysId, compId);
}

// ── LOG_ERASE (ID 121) ─────────────────────────────────────

/** Erase all on-board logs. */
export function encodeLogErase(
  targetSys: number,
  targetComp: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(2);
  payload[0] = targetSys;
  payload[1] = targetComp;
  return buildFrame(121, payload, sysId, compId);
}

// ── LOG_REQUEST_END (ID 122) ────────────────────────────────

/** Stop log transfer and resume normal logging. */
export function encodeLogRequestEnd(
  targetSys: number,
  targetComp: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(2);
  payload[0] = targetSys;
  payload[1] = targetComp;
  return buildFrame(122, payload, sysId, compId);
}

// ── FENCE_POINT (ID 160) ────────────────────────────────────

/** Encode a single fence point for upload. */
export function encodeFencePoint(
  targetSys: number,
  targetComp: number,
  idx: number,
  count: number,
  lat: number,
  lon: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(12);
  const dv = new DataView(payload.buffer);
  dv.setFloat32(0, lat, true);   // lat
  dv.setFloat32(4, lon, true);   // lon
  payload[8] = targetSys;
  payload[9] = targetComp;
  payload[10] = idx;
  payload[11] = count;
  return buildFrame(160, payload, sysId, compId);
}

// ── FENCE_FETCH_POINT (ID 161) ──────────────────────────────

/** Request a specific fence point by index. */
export function encodeFenceFetchPoint(
  targetSys: number,
  targetComp: number,
  idx: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  // FENCE_FETCH_POINT is exactly target_system, target_component, idx.
  const payload = new Uint8Array(3);
  payload[0] = targetSys;
  payload[1] = targetComp;
  payload[2] = idx;
  return buildFrame(161, payload, sysId, compId);
}
