/**
 * Intel HEX firmware file parser.
 *
 * Handles record types 00 (data), 01 (EOF), 02 (extended segment),
 * 04 (extended linear address), 05 (start linear address).
 * Groups sequential addresses into contiguous FirmwareBlock entries.
 *
 * The parser is strict: every record must be well-formed hex whose length
 * matches its byte count and whose checksum is valid, parsing stops at the
 * EOF record, and overlapping data records are rejected. A malformed or
 * concatenated file must never turn into overlapping or misplaced writes.
 *
 * @module protocol/firmware/hex-parser
 */

import type { ParsedFirmware, FirmwareBlock } from "./types";

const HEX_RECORD = /^:([0-9A-Fa-f]{2})+$/;

/**
 * Parse an Intel HEX file into firmware blocks.
 *
 * @param content — Raw .hex file content
 * @returns Parsed firmware with one or more contiguous blocks
 */
export function parseHexFile(content: string): ParsedFirmware {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("Invalid HEX file: no records found");
  }

  let extendedAddress = 0;
  const dataEntries: { address: number; data: Uint8Array }[] = [];
  let totalBytes = 0;
  let sawEof = false;

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];
    if (!HEX_RECORD.test(line)) {
      throw new Error(`Invalid HEX file: malformed record on line ${lineNo + 1}`);
    }
    const bytes = hexLineToBytes(line);
    if (bytes.length < 5 || bytes.length !== bytes[0] + 5) {
      throw new Error(`Invalid HEX file: record length does not match byte count on line ${lineNo + 1}`);
    }
    validateChecksum(bytes, lineNo + 1);

    const byteCount = bytes[0];
    const offset = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = bytes.slice(4, 4 + byteCount);

    if (recordType === 0x01) {
      // EOF: nothing after it is part of this image.
      sawEof = true;
      break;
    }

    switch (recordType) {
      case 0x00: // Data record
        dataEntries.push({
          address: (extendedAddress + offset) >>> 0,
          data: new Uint8Array(data),
        });
        totalBytes += byteCount;
        break;

      case 0x02: // Extended segment address
        if (byteCount !== 2) throw new Error(`Invalid HEX file: bad segment record on line ${lineNo + 1}`);
        extendedAddress = (((data[0] << 8) | data[1]) << 4) >>> 0;
        break;

      case 0x04: // Extended linear address
        if (byteCount !== 2) throw new Error(`Invalid HEX file: bad linear address record on line ${lineNo + 1}`);
        extendedAddress = (((data[0] << 8) | data[1]) * 0x10000) >>> 0;
        break;

      case 0x03: // Start segment address (entry point, ignored for flashing)
      case 0x05: // Start linear address (entry point, ignored for flashing)
        break;

      default:
        throw new Error(`Invalid HEX file: unknown record type 0x${recordType.toString(16).padStart(2, "0")} on line ${lineNo + 1}`);
    }
  }

  if (!sawEof) {
    throw new Error("Invalid HEX file: missing end-of-file record");
  }
  if (dataEntries.length === 0) {
    throw new Error("Invalid HEX file: no data records found");
  }

  // Sort by address and merge contiguous entries into blocks
  dataEntries.sort((a, b) => a.address - b.address);
  const blocks: FirmwareBlock[] = [];
  let currentBlock: { address: number; chunks: Uint8Array[] } | null = null;
  let currentEnd = 0;

  for (const entry of dataEntries) {
    if (currentBlock && entry.address < currentEnd) {
      throw new Error(
        `Invalid HEX file: overlapping data at 0x${entry.address.toString(16).toUpperCase().padStart(8, "0")}`,
      );
    }
    if (currentBlock && entry.address === currentEnd) {
      // Contiguous — append to current block
      currentBlock.chunks.push(entry.data);
      currentEnd += entry.data.length;
    } else {
      // Gap — finalize previous block, start new one
      if (currentBlock) {
        blocks.push(finalizeBlock(currentBlock));
      }
      currentBlock = { address: entry.address, chunks: [entry.data] };
      currentEnd = entry.address + entry.data.length;
    }
  }
  if (currentBlock) {
    blocks.push(finalizeBlock(currentBlock));
  }

  return { blocks, totalBytes };
}

/** Convert a validated hex record line (":AABBCC...") to a byte array. */
function hexLineToBytes(line: string): number[] {
  const hex = line.slice(1); // Remove leading ':'
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

/** Validate the checksum of a parsed hex record. */
function validateChecksum(bytes: number[], lineNo: number): void {
  let sum = 0;
  for (const b of bytes) {
    sum = (sum + b) & 0xff;
  }
  if (sum !== 0) {
    throw new Error(`Invalid HEX file: checksum mismatch on line ${lineNo}`);
  }
}

/** Merge a block's chunks into a single contiguous Uint8Array. */
function finalizeBlock(block: { address: number; chunks: Uint8Array[] }): FirmwareBlock {
  const totalLength = block.chunks.reduce((sum, c) => sum + c.length, 0);
  const data = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of block.chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return { address: block.address, data };
}
