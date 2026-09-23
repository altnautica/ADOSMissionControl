/**
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import {
  ERROR_IN_PROGRESS,
  ERROR_INVALID_MODE,
  ERROR_OK,
  ERROR_UNKNOWN,
  decodeBeginFirmwareUpdateRequest,
  decodeBeginFirmwareUpdateResponse,
  encodeBeginFirmwareUpdateRequest,
  encodeBeginFirmwareUpdateResponse,
} from "@/lib/dronecan/dsdl/begin-firmware-update";

describe("dsdl BeginFirmwareUpdate", () => {
  it("error code constants match the DSDL", () => {
    expect(ERROR_OK).toBe(0);
    expect(ERROR_INVALID_MODE).toBe(1);
    expect(ERROR_IN_PROGRESS).toBe(2);
    expect(ERROR_UNKNOWN).toBe(255);
  });

  it("round-trips a request with source_node_id=0 and 'a.bin' path", () => {
    const original = { source_node_id: 0, image_file_remote_path: "a.bin" };
    const buf = encodeBeginFirmwareUpdateRequest(original);
    const decoded = decodeBeginFirmwareUpdateRequest(buf);
    expect(decoded).toEqual(original);
  });

  it("round-trips a request with an explicit source node", () => {
    const original = {
      source_node_id: 127,
      image_file_remote_path: "AP_Periph.bin",
    };
    const decoded = decodeBeginFirmwareUpdateRequest(
      encodeBeginFirmwareUpdateRequest(original),
    );
    expect(decoded).toEqual(original);
  });

  it("rejects paths longer than 200 bytes", () => {
    const longPath = "x".repeat(201);
    expect(() =>
      encodeBeginFirmwareUpdateRequest({
        source_node_id: 0,
        image_file_remote_path: longPath,
      }),
    ).toThrow();
  });

  it("round-trips an error response", () => {
    const original = {
      error: ERROR_INVALID_MODE,
      optional_error_message: "node is not in MAINTENANCE",
    };
    const decoded = decodeBeginFirmwareUpdateResponse(
      encodeBeginFirmwareUpdateResponse(original),
    );
    expect(decoded).toEqual(original);
  });

  it("encodes the OK response as a single zero byte", () => {
    const buf = encodeBeginFirmwareUpdateResponse({
      error: ERROR_OK,
      optional_error_message: "",
    });
    expect(Array.from(buf)).toEqual([0x00]);
  });

  it("caps the error message at 127 bytes (uint8[<128])", () => {
    const at = { error: ERROR_INVALID_MODE, optional_error_message: "x".repeat(127) };
    expect(encodeBeginFirmwareUpdateResponse(at)).toHaveLength(128);
    expect(() =>
      encodeBeginFirmwareUpdateResponse({ ...at, optional_error_message: "x".repeat(128) }),
    ).toThrow(/127/);
  });
});
