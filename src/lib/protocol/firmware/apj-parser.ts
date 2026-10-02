/**
 * ArduPilot APJ firmware file parser.
 *
 * APJ files are JSON with a base64-encoded, zlib-compressed application
 * image: `{ "board_id": N, "image": "base64(zlib(app))", "image_size": N, ... }`.
 *
 * The image is the application only. It is written by the ArduPilot (PX4
 * protocol) bootloader at its own application offset, so the parsed block
 * starts at offset 0 of the app area and is flagged `bootloaderApp`. DFU and
 * the ST ROM bootloader need the `_with_bl.hex` image instead.
 *
 * @module protocol/firmware/apj-parser
 */

import pako from "pako";
import type { ParsedFirmware } from "./types";

/**
 * Parse an ArduPilot .apj firmware file.
 *
 * @param content — Raw file content as string (JSON)
 * @returns Parsed application image (inflated), flagged `bootloaderApp`
 */
export function parseApjFile(content: string): ParsedFirmware {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error("Invalid APJ file: not valid JSON");
  }

  if (typeof json.image !== "string") {
    throw new Error("Invalid APJ file: missing 'image' field");
  }
  if (typeof json.image_size !== "number") {
    throw new Error("Invalid APJ file: missing 'image_size' field");
  }

  let compressed: Uint8Array;
  try {
    const binaryString = atob(json.image as string);
    compressed = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      compressed[i] = binaryString.charCodeAt(i);
    }
  } catch {
    throw new Error("Invalid APJ file: corrupt firmware image data");
  }

  let data: Uint8Array;
  try {
    data = pako.inflate(compressed);
  } catch {
    throw new Error("Invalid APJ file: zlib decompression failed");
  }

  if (data.length !== json.image_size) {
    throw new Error(
      `Invalid APJ file: decompressed size ${data.length} does not match image_size ${json.image_size}`,
    );
  }

  const boardId = typeof json.board_id === "number" ? json.board_id : undefined;
  const boardRevision = typeof json.board_revision === "number" ? json.board_revision : undefined;
  const description = typeof json.summary === "string" ? json.summary : undefined;

  return {
    blocks: [{ address: 0, data }],
    totalBytes: data.length,
    boardId,
    boardRevision,
    description,
    bootloaderApp: true,
  };
}
