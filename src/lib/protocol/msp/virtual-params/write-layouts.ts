/**
 * Read-to-write payload conversion for virtual parameters.
 *
 * Most MSP config blocks are written back with the same byte layout they are
 * read with, so a read payload can be patched and sent as-is. A few are not:
 * their write command drops read-only fields or orders the fields
 * differently. For those, the read payload is first rebuilt into the write
 * layout, and each param's `encode` patches its write offset in the result.
 *
 * @module protocol/msp/virtual-params/write-layouts
 */

import {
  MSP_BLACKBOX_CONFIG,
  MSP_MOTOR_CONFIG,
  MSP_VTX_CONFIG,
  getU16,
  getU8,
} from "./types";

/**
 * MSP_VTX_CONFIG read: type, band, channel, power, pitmode, U16 freq,
 * deviceReady, lowPowerDisarm, U16 pitModeFreq, table fields.
 * MSP_SET_VTX_CONFIG write: U16 freq-or-band/channel index, power, pitmode,
 * lowPowerDisarm, U16 pitModeFreq, band, channel, U16 freq.
 */
function vtxWrite(read: Uint8Array): Uint8Array {
  const band = getU8(read, 1);
  const channel = getU8(read, 2);
  const freq = getU16(read, 5);
  // Values up to 63 are read as a band/channel index, larger ones as MHz.
  const first = band > 0 && channel > 0 ? (band - 1) * 8 + (channel - 1) : freq;
  const pitModeFreq = getU16(read, 9);
  return Uint8Array.of(
    first & 0xff, (first >> 8) & 0xff,
    getU8(read, 3),
    getU8(read, 4),
    getU8(read, 8),
    pitModeFreq & 0xff, (pitModeFreq >> 8) & 0xff,
    band,
    channel,
    freq & 0xff, (freq >> 8) & 0xff,
  );
}

/** MSP_BLACKBOX_CONFIG read leads with a "supported" flag the write omits. */
function blackboxWrite(read: Uint8Array): Uint8Array {
  return read.slice(1);
}

/**
 * MSP_MOTOR_CONFIG read: U16 min throttle, U16 max throttle, U16 min command,
 * motor count, pole count, DShot telemetry, ESC sensor.
 * MSP_SET_MOTOR_CONFIG write: the three U16s, pole count, DShot telemetry.
 */
function motorWrite(read: Uint8Array): Uint8Array {
  const head = read.slice(0, 6);
  if (read.length < 9) return head;
  const out = new Uint8Array(8);
  out.set(head, 0);
  out[6] = read[7];
  out[7] = read[8];
  return out;
}

const CONVERTERS: ReadonlyMap<number, (read: Uint8Array) => Uint8Array> = new Map([
  [MSP_VTX_CONFIG, vtxWrite],
  [MSP_BLACKBOX_CONFIG, blackboxWrite],
  [MSP_MOTOR_CONFIG, motorWrite],
]);

/** Build the payload the write command expects from a read response. */
export function toWritePayload(readCmd: number, read: Uint8Array): Uint8Array {
  const convert = CONVERTERS.get(readCmd);
  return convert ? convert(read) : new Uint8Array(read);
}
