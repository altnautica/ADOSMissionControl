/**
 * @module esc-raw-command
 * @description Codec for `uavcan.equipment.esc.RawCommand` (data type id 1030).
 *
 * Wire layout:
 *   int14[<=20] cmd      array of signed 14-bit motor commands
 *
 * `cmd` is the only field, so the length prefix is omitted by the
 * tail-array optimization. Each entry occupies exactly 14 bits and
 * consecutive entries pack across byte boundaries in the DroneCAN scalar
 * layout described in `bit-buffer.ts`: `[0, 1229]` is `00 03 34 40`.
 *
 * @license GPL-3.0-only
 */

import { BitReader, BitWriter } from "../bit-buffer";

/** Maximum number of channels permitted by the DSDL definition. */
export const ESC_RAW_COMMAND_MAX_CHANNELS = 20;

/** Inclusive low end of a signed 14-bit motor command. */
export const ESC_RAW_COMMAND_MIN = -8192;
/** Inclusive high end of a signed 14-bit motor command. */
export const ESC_RAW_COMMAND_MAX = 8191;

/** Bit width of a single `cmd` entry. */
export const ESC_RAW_COMMAND_BITS = 14;

/** Decoded `uavcan.equipment.esc.RawCommand` message. */
export interface EscRawCommand {
  /** Per-channel signed 14-bit motor command. */
  cmd: number[];
}

/** Encode a `uavcan.equipment.esc.RawCommand` message to its wire bytes. */
export function encodeRawCommand(msg: EscRawCommand): Uint8Array {
  if (msg.cmd.length > ESC_RAW_COMMAND_MAX_CHANNELS) {
    throw new RangeError(
      `RawCommand.cmd has ${msg.cmd.length} entries; max ${ESC_RAW_COMMAND_MAX_CHANNELS}`,
    );
  }
  const w = new BitWriter();
  for (const raw of msg.cmd) {
    const v = clampInt14(raw);
    w.write(v, ESC_RAW_COMMAND_BITS);
  }
  return w.toUint8Array();
}

/**
 * Decode a `uavcan.equipment.esc.RawCommand` payload. Provided for
 * symmetry and test coverage; the GCS only encodes these outbound.
 */
export function decodeRawCommand(buf: Uint8Array): EscRawCommand {
  const r = new BitReader(buf);
  const cmd: number[] = [];
  while (
    r.remaining() >= ESC_RAW_COMMAND_BITS &&
    cmd.length < ESC_RAW_COMMAND_MAX_CHANNELS
  ) {
    cmd.push(r.read(ESC_RAW_COMMAND_BITS, true));
  }
  return { cmd };
}

function clampInt14(v: number): number {
  const n = v | 0;
  if (n < ESC_RAW_COMMAND_MIN) return ESC_RAW_COMMAND_MIN;
  if (n > ESC_RAW_COMMAND_MAX) return ESC_RAW_COMMAND_MAX;
  return n;
}
