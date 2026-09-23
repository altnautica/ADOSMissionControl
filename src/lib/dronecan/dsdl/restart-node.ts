/**
 * @module restart-node
 * @description Codec for `uavcan.protocol.RestartNode` (service type id 5).
 *
 * Request:  uint40 magic_number  (5 bytes little-endian, must be 0xACCE551B1E)
 * Response: bool   ok            (one bit: the most significant bit of byte 0)
 * @license GPL-3.0-only
 */

export const RESTART_NODE_MAGIC = BigInt("0xACCE551B1E");

const FF = BigInt(0xff);
const EIGHT = BigInt(8);

export interface RestartNodeRequest {
  magic_number: bigint;
}

export interface RestartNodeResponse {
  ok: boolean;
}

export function encodeRestartNodeRequest(
  req: RestartNodeRequest = { magic_number: RESTART_NODE_MAGIC },
): Uint8Array {
  const out = new Uint8Array(5);
  let v = req.magic_number;
  for (let i = 0; i < 5; i++) {
    out[i] = Number(v & FF);
    v >>= EIGHT;
  }
  return out;
}

export function decodeRestartNodeRequest(buf: Uint8Array): RestartNodeRequest {
  if (buf.length < 5) {
    throw new Error(`RestartNodeRequest too short: ${buf.length}`);
  }
  let v = BigInt(0);
  for (let i = 0; i < 5; i++) {
    v |= BigInt(buf[i]) << BigInt(i * 8);
  }
  return { magic_number: v };
}

export function encodeRestartNodeResponse(
  res: RestartNodeResponse,
): Uint8Array {
  return new Uint8Array([res.ok ? 0x80 : 0]);
}

export function decodeRestartNodeResponse(buf: Uint8Array): RestartNodeResponse {
  if (buf.length < 1) {
    throw new Error(`RestartNodeResponse too short: ${buf.length}`);
  }
  return { ok: (buf[0] & 0x80) !== 0 };
}
