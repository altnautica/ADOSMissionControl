/**
 * @module param-executeopcode
 * @description Codec for `uavcan.protocol.param.ExecuteOpcode` (service id 10).
 *
 * Request layout:
 *   uint8  opcode    (0 = SAVE, 1 = ERASE)
 *   int48  argument  (six bytes, signed, little-endian)
 *
 * Response layout:
 *   int48  argument
 *   bool   ok        (one bit: the most significant bit of byte 6)
 * @license GPL-3.0-only
 */

export const OPCODE_SAVE = 0;
export const OPCODE_ERASE = 1;

export interface ParamExecuteOpcodeRequest {
  opcode: number;
  argument: bigint;
}

export interface ParamExecuteOpcodeResponse {
  argument: bigint;
  ok: boolean;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const FF = BigInt(0xff);
const EIGHT = BigInt(8);
const MASK_48 = (ONE << BigInt(48)) - ONE;
const SIGN_BIT_48 = ONE << BigInt(47);
const TWO_POW_48 = ONE << BigInt(48);

function encodeInt48(value: bigint): Uint8Array {
  let u = value & MASK_48;
  if (value < ZERO) u = (MASK_48 + ONE + value) & MASK_48;
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    out[i] = Number(u & FF);
    u >>= EIGHT;
  }
  return out;
}

function decodeInt48(buf: Uint8Array, off: number): bigint {
  let u = ZERO;
  for (let i = 0; i < 6; i++) {
    u |= BigInt(buf[off + i] ?? 0) << BigInt(i * 8);
  }
  if ((u & SIGN_BIT_48) !== ZERO) {
    return u - TWO_POW_48;
  }
  return u;
}

export function encodeParamExecuteOpcodeRequest(
  req: ParamExecuteOpcodeRequest,
): Uint8Array {
  const out = new Uint8Array(7);
  out[0] = req.opcode & 0xff;
  out.set(encodeInt48(req.argument), 1);
  return out;
}

export function decodeParamExecuteOpcodeRequest(
  buf: Uint8Array,
): ParamExecuteOpcodeRequest {
  if (buf.length < 7) {
    throw new Error(`ParamExecuteOpcodeRequest too short: ${buf.length}`);
  }
  return { opcode: buf[0], argument: decodeInt48(buf, 1) };
}

export function encodeParamExecuteOpcodeResponse(
  res: ParamExecuteOpcodeResponse,
): Uint8Array {
  const out = new Uint8Array(7);
  out.set(encodeInt48(res.argument), 0);
  out[6] = res.ok ? 0x80 : 0;
  return out;
}

export function decodeParamExecuteOpcodeResponse(
  buf: Uint8Array,
): ParamExecuteOpcodeResponse {
  if (buf.length < 7) {
    throw new Error(`ParamExecuteOpcodeResponse too short: ${buf.length}`);
  }
  return { argument: decodeInt48(buf, 0), ok: (buf[6] & 0x80) !== 0 };
}
