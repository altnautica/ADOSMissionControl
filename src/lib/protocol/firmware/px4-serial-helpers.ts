/**
 * CRC and image helpers for the PX4 bootloader protocol (also spoken by the
 * ArduPilot bootloader).
 *
 * @module protocol/firmware/px4-serial-helpers
 */

import type { ParsedFirmware } from "./types";

// ── CRC32 Lookup Table ──────────────────────────────────────

/** Pre-computed CRC32 table (IEEE 802.3 reflected polynomial). */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  CRC32_TABLE[i] = crc;
}

/**
 * The CRC the bootloader answers to GET_CRC: the reflected CRC-32 table with
 * initial state 0 and no final XOR, taken over the whole application area of
 * `fwSize` bytes, where flash past the image is erased (0xFF).
 *
 * `image` must already be padded to a multiple of 4 bytes (see
 * {@link padToWord}); `fwSize` is the INFO_FLASH_SIZE the bootloader reports.
 */
export function px4BootloaderCrc(image: Uint8Array, fwSize: number): number {
  let state = 0;
  for (let i = 0; i < image.length; i++) {
    state = (CRC32_TABLE[(state ^ image[i]) & 0xff] ^ (state >>> 8)) >>> 0;
  }
  for (let i = image.length; i < fwSize; i++) {
    state = (CRC32_TABLE[(state ^ 0xff) & 0xff] ^ (state >>> 8)) >>> 0;
  }
  return state >>> 0;
}

/** Pad an image with erased-flash bytes (0xFF) to a multiple of 4 bytes. PROG_MULTI rejects other lengths. */
export function padToWord(image: Uint8Array): Uint8Array {
  const rem = image.length % 4;
  if (rem === 0) return image;
  const padded = new Uint8Array(image.length + (4 - rem));
  padded.set(image);
  padded.fill(0xff, image.length);
  return padded;
}

// ── PX4 Bootloader Protocol Constants ────────────────────────

export const PX4_BL = {
  INSYNC: 0x12,
  EOC: 0x20,
  OK: 0x10,
  FAILED: 0x11,
  INVALID: 0x13,
  GET_SYNC: 0x21,
  GET_DEVICE: 0x22,
  CHIP_ERASE: 0x23,
  PROG_MULTI: 0x27,
  GET_CRC: 0x29,
  REBOOT: 0x30,
  /** GET_DEVICE info selectors. */
  INFO_BL_REV: 0x01,
  INFO_BOARD_ID: 0x02,
  INFO_BOARD_REV: 0x03,
  INFO_FLASH_SIZE: 0x04,
  /** Largest PROG_MULTI payload; a multiple of 4. */
  PROG_MULTI_MAX: 252,
  DEFAULT_TIMEOUT: 5000,
  ERASE_TIMEOUT: 30000,
} as const;

/**
 * The single application image a PX4-protocol bootloader writes. Only
 * bootloader application images (.apj, .px4, app .bin) qualify: an absolute
 * image would be written at the app offset and corrupt the board.
 */
export function bootloaderAppImage(firmware: ParsedFirmware): Uint8Array {
  if (!firmware.bootloaderApp || firmware.blocks.length !== 1 || firmware.blocks[0].address !== 0) {
    throw new Error(
      "The bootloader takes an application image (.apj, .px4 or application .bin). " +
        "Use USB DFU or the ST ROM bootloader for a .hex image.",
    );
  }
  return padToWord(firmware.blocks[0].data);
}
