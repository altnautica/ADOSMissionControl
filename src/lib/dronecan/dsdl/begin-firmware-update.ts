/**
 * @module begin-firmware-update
 * @description Codec for `uavcan.protocol.file.BeginFirmwareUpdate`
 * (service type id 40).
 *
 * Request layout:
 *   uint8       source_node_id           (0 = use caller's node id)
 *   uint8[<=200] image_file_remote_path  (tail-array)
 *
 * Response layout:
 *   uint8       error
 *   uint8[<128] optional_error_message  (tail-array, at most 127 bytes)
 *
 * Error code constants:
 *   OK = 0, INVALID_MODE = 1, IN_PROGRESS = 2, UNKNOWN = 255.
 * @license GPL-3.0-only
 */

export const ERROR_OK = 0;
export const ERROR_INVALID_MODE = 1;
export const ERROR_IN_PROGRESS = 2;
export const ERROR_UNKNOWN = 255;

export interface BeginFirmwareUpdateRequest {
  source_node_id: number;
  image_file_remote_path: string;
}

export interface BeginFirmwareUpdateResponse {
  error: number;
  optional_error_message: string;
}

export function encodeBeginFirmwareUpdateRequest(
  req: BeginFirmwareUpdateRequest,
): Uint8Array {
  const pathBytes = new TextEncoder().encode(req.image_file_remote_path);
  if (pathBytes.length > 200) {
    throw new Error("image_file_remote_path must be <= 200 bytes");
  }
  const out = new Uint8Array(1 + pathBytes.length);
  out[0] = req.source_node_id & 0xff;
  out.set(pathBytes, 1);
  return out;
}

export function decodeBeginFirmwareUpdateRequest(
  buf: Uint8Array,
): BeginFirmwareUpdateRequest {
  if (buf.length < 1) {
    throw new Error(`BeginFirmwareUpdateRequest too short: ${buf.length}`);
  }
  return {
    source_node_id: buf[0],
    image_file_remote_path: new TextDecoder().decode(buf.subarray(1)),
  };
}

export function encodeBeginFirmwareUpdateResponse(
  res: BeginFirmwareUpdateResponse,
): Uint8Array {
  const msgBytes = new TextEncoder().encode(res.optional_error_message);
  if (msgBytes.length > 127) {
    throw new Error("optional_error_message must be <= 127 bytes");
  }
  const out = new Uint8Array(1 + msgBytes.length);
  out[0] = res.error & 0xff;
  out.set(msgBytes, 1);
  return out;
}

export function decodeBeginFirmwareUpdateResponse(
  buf: Uint8Array,
): BeginFirmwareUpdateResponse {
  if (buf.length < 1) {
    throw new Error(`BeginFirmwareUpdateResponse too short: ${buf.length}`);
  }
  return {
    error: buf[0],
    optional_error_message: new TextDecoder().decode(buf.subarray(1)),
  };
}
