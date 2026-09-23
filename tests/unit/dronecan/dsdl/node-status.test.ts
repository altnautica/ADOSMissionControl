/**
 * @license GPL-3.0-only
 *
 * Expected bytes are reference DroneCAN encodings of `uavcan.protocol.NodeStatus`.
 * Byte 4 packs health (bits 7..6), mode (bits 5..3) and sub_mode (bits 2..0).
 */

import { describe, expect, it } from "vitest";
import {
  HEALTH_CRITICAL,
  HEALTH_ERROR,
  HEALTH_OK,
  HEALTH_WARNING,
  MODE_MAINTENANCE,
  MODE_OFFLINE,
  MODE_OPERATIONAL,
  MODE_SOFTWARE_UPDATE,
  decodeNodeStatus,
  encodeNodeStatus,
  type NodeStatus,
} from "@/lib/dronecan/dsdl/node-status";

const VECTORS: Array<{ status: NodeStatus; bytes: number[] }> = [
  {
    status: {
      uptime_sec: 12345,
      health: HEALTH_WARNING,
      mode: MODE_MAINTENANCE,
      vendor_specific_status_code: 0xabcd,
    },
    bytes: [0x39, 0x30, 0x00, 0x00, 0x50, 0xcd, 0xab],
  },
  {
    status: {
      uptime_sec: 1,
      health: HEALTH_ERROR,
      mode: MODE_SOFTWARE_UPDATE,
      vendor_specific_status_code: 0,
    },
    bytes: [0x01, 0x00, 0x00, 0x00, 0x98, 0x00, 0x00],
  },
  {
    status: {
      uptime_sec: 1,
      health: HEALTH_OK,
      mode: MODE_OPERATIONAL,
      vendor_specific_status_code: 0,
    },
    bytes: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  },
];

describe("dsdl NodeStatus", () => {
  for (const v of VECTORS) {
    it(`encodes health ${v.status.health} / mode ${v.status.mode} to the reference bytes`, () => {
      expect(Array.from(encodeNodeStatus(v.status))).toEqual(v.bytes);
    });

    it(`decodes health ${v.status.health} / mode ${v.status.mode} from the reference bytes`, () => {
      expect(decodeNodeStatus(new Uint8Array(v.bytes))).toEqual(v.status);
    });
  }

  it("ignores the reserved sub_mode bits on receive", () => {
    // CRITICAL, OFFLINE, sub_mode 5.
    const status = decodeNodeStatus(
      new Uint8Array([0x04, 0x03, 0x02, 0x01, 0xfd, 0x02, 0x01]),
    );
    expect(status).toEqual({
      uptime_sec: 0x01020304,
      health: HEALTH_CRITICAL,
      mode: MODE_OFFLINE,
      vendor_specific_status_code: 0x0102,
    });
  });

  it("rejects a buffer shorter than 7 bytes", () => {
    expect(() => decodeNodeStatus(new Uint8Array(6))).toThrow();
  });
});
