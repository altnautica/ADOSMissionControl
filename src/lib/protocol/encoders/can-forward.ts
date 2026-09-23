/**
 * MAVLink CAN passthrough encoders: CAN_FORWARD (MAV_CMD 32000) +
 * CAN_FRAME (msg 386) + CANFD_FRAME (msg 387) + CAN_FILTER_MODIFY (msg 388).
 *
 * Wire layouts come from the MAVLink v2 common dialect. Every field is
 * little-endian. Classic CAN frames carry 0-8 data bytes (padded to 8 on
 * the wire); FD frames carry 0-64 (padded to 64). The MAV_CMD_CAN_FORWARD
 * command (32000) goes through COMMAND_LONG with `param1` = bus index.
 *
 * Identifier convention matches `CanFrame.id`: the encoder writes the
 * 11-bit or 29-bit value directly into the wire `id` field. Callers that
 * need to flag an extended frame set bit 31 of the id field per the
 * UAVCAN/DroneCAN passthrough convention.
 *
 * @module protocol/encoders/can-forward
 */

import { buildFrame } from "./frame";
import { encodeCommandLong } from "./core";
import type { CanFrame } from "../transport/can-transport";

/** MAV_CMD identifier for CAN_FORWARD (enables CAN passthrough on a bus). */
export const MAV_CMD_CAN_FORWARD = 32000;

/**
 * Send MAV_CMD_CAN_FORWARD via COMMAND_LONG.
 *
 * The FC enables CAN passthrough on the requested bus (1 or 2) and starts
 * emitting CAN_FRAME / CANFD_FRAME messages until the command is sent
 * again with `bus = 0` (disable).
 *
 * @param targetSys  - Target system ID (the FC).
 * @param targetComp - Target component ID (the FC autopilot, usually 1).
 * @param bus        - CAN bus to forward. 1 or 2 to enable a bus, 0 to disable.
 */
export function encodeCanForward(
  targetSys: number,
  targetComp: number,
  bus: number,
  sysId = 255,
  compId = 190,
): Uint8Array {
  return encodeCommandLong(
    targetSys,
    targetComp,
    MAV_CMD_CAN_FORWARD,
    bus, // param1 = bus index
    0, 0, 0, 0, 0, 0,
    sysId,
    compId,
  );
}

/**
 * Encode a CAN_FRAME (msg 386).
 *
 * Wire layout (16 bytes, little-endian):
 *   uint32 id              [0..3]
 *   uint8  target_system   [4]
 *   uint8  target_component[5]
 *   uint8  bus             [6]
 *   uint8  len             [7]
 *   uint8  data[8]         [8..15]
 */
export function encodeCanFrame(
  targetSys: number,
  targetComp: number,
  bus: number,
  frame: CanFrame,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(16);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, frame.id >>> 0, true);
  payload[4] = targetSys;
  payload[5] = targetComp;
  payload[6] = bus;
  const dataLen = Math.min(frame.data.length, 8);
  payload[7] = Math.min(frame.dlc & 0xff, 8);
  payload.set(frame.data.subarray(0, dataLen), 8);
  return buildFrame(386, payload, sysId, compId);
}

/**
 * Encode a CANFD_FRAME (msg 387).
 *
 * Wire layout (72 bytes, little-endian):
 *   uint32 id              [0..3]
 *   uint8  target_system   [4]
 *   uint8  target_component[5]
 *   uint8  bus             [6]
 *   uint8  len             [7]
 *   uint8  data[64]        [8..71]
 *
 * Per common.xml MAVLink CANFD_FRAME wire order matches CAN_FRAME with a
 * larger data buffer. CRC_EXTRA = 4.
 */
export function encodeCanFdFrame(
  targetSys: number,
  targetComp: number,
  bus: number,
  frame: CanFrame,
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(72);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, frame.id >>> 0, true);
  payload[4] = targetSys;
  payload[5] = targetComp;
  payload[6] = bus;
  const dataLen = Math.min(frame.data.length, 64);
  payload[7] = Math.min(frame.dlc & 0xff, 64);
  payload.set(frame.data.subarray(0, dataLen), 8);
  return buildFrame(387, payload, sysId, compId);
}

/**
 * Encode a CAN_FILTER_MODIFY (msg 388).
 *
 * The GCS does not currently drive hardware filter slots; this encoder
 * exists so a caller can narrow the forwarded CAN id set when needed.
 *
 * Wire layout (37 bytes, little-endian):
 *   uint16 ids[16]            [0..31]
 *   uint8  target_system      [32]
 *   uint8  target_component   [33]
 *   uint8  bus                [34]
 *   uint8  operation          [35]   // CAN_FILTER_OP enum
 *   uint8  num_ids            [36]
 */
export function encodeCanFilterModify(
  targetSys: number,
  targetComp: number,
  bus: number,
  operation: number,
  ids: number[],
  sysId = 255,
  compId = 190,
): Uint8Array {
  const payload = new Uint8Array(37);
  const dv = new DataView(payload.buffer);
  const numIds = Math.min(ids.length, 16);
  for (let i = 0; i < numIds; i++) {
    dv.setUint16(i * 2, ids[i] & 0xffff, true);
  }
  payload[32] = targetSys;
  payload[33] = targetComp;
  payload[34] = bus;
  payload[35] = operation & 0xff;
  payload[36] = numIds;
  return buildFrame(388, payload, sysId, compId);
}
