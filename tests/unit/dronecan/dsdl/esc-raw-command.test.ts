/**
 * @license GPL-3.0-only
 *
 * Expected bytes are reference DroneCAN encodings of `uavcan.equipment.esc.RawCommand`.
 * A wrong bit order shifts setpoints onto neighbouring channels, so every
 * vector is checked in both directions against the wire bytes.
 */

import { describe, expect, it } from "vitest";
import {
  ESC_RAW_COMMAND_MAX_CHANNELS,
  decodeRawCommand,
  encodeRawCommand,
} from "@/lib/dronecan/dsdl/esc-raw-command";

const VECTORS: Array<{ cmd: number[]; bytes: number[] }> = [
  // Channel 1 at 1229, channel 0 idle: the ESC sweep's 1150 µs step.
  { cmd: [0, 1229], bytes: [0x00, 0x03, 0x34, 0x40] },
  { cmd: [1229, 0], bytes: [0xcd, 0x10, 0x00, 0x00] },
  { cmd: [1234], bytes: [0xd2, 0x10] },
  { cmd: [-1, 8191, -8192], bytes: [0xff, 0xff, 0xfd, 0xf0, 0x08, 0x00] },
];

describe("dsdl esc.RawCommand", () => {
  for (const v of VECTORS) {
    it(`encodes [${v.cmd.join(", ")}] to the reference bytes`, () => {
      expect(Array.from(encodeRawCommand({ cmd: v.cmd }))).toEqual(v.bytes);
    });

    it(`decodes the reference bytes for [${v.cmd.join(", ")}]`, () => {
      expect(decodeRawCommand(new Uint8Array(v.bytes)).cmd).toEqual(v.cmd);
    });
  }

  it("clamps out-of-range commands to the int14 bounds", () => {
    expect(Array.from(encodeRawCommand({ cmd: [99999, -99999] }))).toEqual([
      0xff, 0x7c, 0x02, 0x00,
    ]);
  });

  it("throws when more than 20 channels are supplied", () => {
    const cmd = new Array(ESC_RAW_COMMAND_MAX_CHANNELS + 1).fill(0);
    expect(() => encodeRawCommand({ cmd })).toThrow();
  });
});
