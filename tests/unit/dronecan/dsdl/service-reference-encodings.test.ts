/**
 * @license GPL-3.0-only
 *
 * Reference DroneCAN encodings of the service types the GCS speaks, checked in
 * both directions. A DSDL `bool` is one bit, so a lone `ok` flag is the most
 * significant bit of its byte (0x80), and GetNodeInfo embeds NodeStatus with
 * health and mode in the top bits of byte 4.
 */

import { describe, expect, it } from "vitest";
import {
  decodeParamExecuteOpcodeRequest,
  decodeParamExecuteOpcodeResponse,
  encodeParamExecuteOpcodeRequest,
  encodeParamExecuteOpcodeResponse,
  OPCODE_ERASE,
} from "@/lib/dronecan/dsdl/param-executeopcode";
import {
  decodeRestartNodeRequest,
  decodeRestartNodeResponse,
  encodeRestartNodeRequest,
  encodeRestartNodeResponse,
  RESTART_NODE_MAGIC,
} from "@/lib/dronecan/dsdl/restart-node";
import {
  decodeGetNodeInfoResponse,
  encodeGetNodeInfoResponse,
  type GetNodeInfoResponse,
} from "@/lib/dronecan/dsdl/get-node-info";
import {
  decodeGetTransportStatsResponse,
  encodeGetTransportStatsResponse,
} from "@/lib/dronecan/dsdl/get-transport-stats";
import {
  decodeFileReadRequest,
  decodeFileReadResponse,
  encodeFileReadRequest,
  encodeFileReadResponse,
} from "@/lib/dronecan/dsdl/file-read";
import {
  decodeBeginFirmwareUpdateRequest,
  decodeBeginFirmwareUpdateResponse,
  encodeBeginFirmwareUpdateRequest,
  encodeBeginFirmwareUpdateResponse,
} from "@/lib/dronecan/dsdl/begin-firmware-update";
import { HEALTH_WARNING, MODE_MAINTENANCE } from "@/lib/dronecan/dsdl/node-status";

function bytes(buf: Uint8Array): number[] {
  return Array.from(buf);
}

describe("param.ExecuteOpcode", () => {
  const request = { opcode: OPCODE_ERASE, argument: BigInt(-2) };
  const requestBytes = [0x01, 0xfe, 0xff, 0xff, 0xff, 0xff, 0xff];
  const okResponse = { argument: BigInt(5), ok: true };
  const okResponseBytes = [0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80];
  const failResponse = { argument: BigInt(-1), ok: false };
  const failResponseBytes = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

  it("round-trips the request against its reference bytes", () => {
    expect(bytes(encodeParamExecuteOpcodeRequest(request))).toEqual(requestBytes);
    expect(decodeParamExecuteOpcodeRequest(new Uint8Array(requestBytes))).toEqual(request);
  });

  it("carries the ok flag in the top bit of byte 6", () => {
    expect(bytes(encodeParamExecuteOpcodeResponse(okResponse))).toEqual(okResponseBytes);
    expect(decodeParamExecuteOpcodeResponse(new Uint8Array(okResponseBytes))).toEqual(okResponse);
    expect(bytes(encodeParamExecuteOpcodeResponse(failResponse))).toEqual(failResponseBytes);
    expect(decodeParamExecuteOpcodeResponse(new Uint8Array(failResponseBytes))).toEqual(failResponse);
  });
});

describe("RestartNode", () => {
  it("sends the magic number as five little-endian bytes", () => {
    const req = { magic_number: RESTART_NODE_MAGIC };
    const reqBytes = [0x1e, 0x1b, 0x55, 0xce, 0xac];
    expect(bytes(encodeRestartNodeRequest(req))).toEqual(reqBytes);
    expect(decodeRestartNodeRequest(new Uint8Array(reqBytes))).toEqual(req);
  });

  it("carries the ok flag in the top bit", () => {
    expect(bytes(encodeRestartNodeResponse({ ok: true }))).toEqual([0x80]);
    expect(decodeRestartNodeResponse(new Uint8Array([0x80]))).toEqual({ ok: true });
    expect(decodeRestartNodeResponse(new Uint8Array([0x00]))).toEqual({ ok: false });
  });
});

describe("GetNodeInfo response", () => {
  const info: GetNodeInfoResponse = {
    status: {
      uptime_sec: 5,
      health: HEALTH_WARNING,
      mode: MODE_MAINTENANCE,
      vendor_specific_status_code: 0,
    },
    software_version: {
      major: 1,
      minor: 2,
      optional_field_flags: 3,
      vcs_commit: 0xdeadbeef,
      image_crc: BigInt("0x0102030405060708"),
    },
    hardware_version: {
      major: 4,
      minor: 5,
      unique_id: Uint8Array.from({ length: 16 }, (_, i) => i),
      certificate_of_authenticity: new Uint8Array([0xaa, 0xbb]),
    },
    name: "org.example.node",
  };
  const infoBytes = [
    0x05, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x01, 0x02, 0x03, 0xef, 0xbe, 0xad, 0xde, 0x08, 0x07,
    0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x04, 0x05, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x02, 0xaa, 0xbb,
    ...new TextEncoder().encode("org.example.node"),
  ];

  it("encodes to the reference bytes", () => {
    expect(bytes(encodeGetNodeInfoResponse(info))).toEqual(infoBytes);
  });

  it("decodes the reference bytes, including the embedded NodeStatus", () => {
    expect(decodeGetNodeInfoResponse(new Uint8Array(infoBytes))).toEqual(info);
  });
});

describe("GetTransportStats response", () => {
  const stats = {
    transfer_count: BigInt(1),
    message_count: BigInt(2),
    error_count: BigInt(3),
    can_iface_stats: [{ frames_tx: BigInt(4), frames_rx: BigInt(5), errors: BigInt(6) }],
  };
  const statsBytes = [1, 2, 3, 4, 5, 6].flatMap((n) => [n, 0, 0, 0, 0, 0]);

  it("round-trips against the reference bytes", () => {
    expect(bytes(encodeGetTransportStatsResponse(stats))).toEqual(statsBytes);
    expect(decodeGetTransportStatsResponse(new Uint8Array(statsBytes))).toEqual(stats);
  });
});

describe("file.Read", () => {
  it("round-trips the request against its reference bytes", () => {
    const req = { offset: BigInt("0x0102030405"), path: "fw.bin" };
    const reqBytes = [0x05, 0x04, 0x03, 0x02, 0x01, 0x66, 0x77, 0x2e, 0x62, 0x69, 0x6e];
    expect(bytes(encodeFileReadRequest(req))).toEqual(reqBytes);
    expect(decodeFileReadRequest(new Uint8Array(reqBytes))).toEqual(req);
  });

  it("round-trips the response against its reference bytes", () => {
    const res = { error: { value: -1 }, data: new Uint8Array([1, 2, 3]) };
    const resBytes = [0xff, 0xff, 0x01, 0x02, 0x03];
    expect(bytes(encodeFileReadResponse(res))).toEqual(resBytes);
    expect(decodeFileReadResponse(new Uint8Array(resBytes))).toEqual(res);
  });
});

describe("file.BeginFirmwareUpdate", () => {
  it("round-trips the request against its reference bytes", () => {
    const req = { source_node_id: 127, image_file_remote_path: "a.bin" };
    const reqBytes = [0x7f, 0x61, 0x2e, 0x62, 0x69, 0x6e];
    expect(bytes(encodeBeginFirmwareUpdateRequest(req))).toEqual(reqBytes);
    expect(decodeBeginFirmwareUpdateRequest(new Uint8Array(reqBytes))).toEqual(req);
  });

  it("round-trips the response against its reference bytes", () => {
    const res = { error: 1, optional_error_message: "no" };
    const resBytes = [0x01, 0x6e, 0x6f];
    expect(bytes(encodeBeginFirmwareUpdateResponse(res))).toEqual(resBytes);
    expect(decodeBeginFirmwareUpdateResponse(new Uint8Array(resBytes))).toEqual(res);
  });
});
