/**
 * Flash operations for STM32 serial bootloader.
 *
 * Erase, write, read, and jump operations extracted from STM32SerialFlasher.
 * Each function takes a context object providing low-level serial helpers.
 *
 * @module protocol/firmware/stm32-serial-flash
 */

import type { FlashProgressCallback, ParsedFirmware, ChipInfo } from "./types";
import { sectorIndicesFor } from "./stm32-chip-table";

// Bootloader commands
const CMD_READ_MEMORY = 0x11;
const CMD_GO = 0x21;
const CMD_WRITE_MEMORY = 0x31;
const CMD_ERASE = 0x43;
const CMD_EXTENDED_ERASE = 0x44;

const WRITE_BLOCK_SIZE = 256;
const READ_BLOCK_SIZE = 256;
const ERASE_TIMEOUT = 30000;

export { WRITE_BLOCK_SIZE, READ_BLOCK_SIZE };

export interface SerialFlashContext {
  sendBytes(data: Uint8Array): Promise<void>;
  sendCommand(cmd: number): Promise<void>;
  sendAddress(address: number): Promise<void>;
  waitForAck(timeoutMs?: number): Promise<void>;
  waitForBytes(count: number, timeoutMs?: number): Promise<number[]>;
  checkAbort(): void;
}

/** Legacy ERASE (0x43) takes at most 255 one-byte page numbers per command (N = 0xFF means global erase). */
const LEGACY_ERASE_MAX_PAGES = 255;

/** Erase the flash sectors covered by firmware blocks, mapped through the chip's real sector map. */
export async function eraseFlash(
  ctx: SerialFlashContext,
  chipInfo: ChipInfo,
  supportsExtendedErase: boolean,
  blocks: ParsedFirmware["blocks"],
): Promise<void> {
  const sectors = new Set<number>();
  for (const block of blocks) {
    for (const s of sectorIndicesFor(chipInfo, block.address, block.data.length)) sectors.add(s);
  }
  const sectorList = Array.from(sectors).sort((a, b) => a - b);

  if (supportsExtendedErase || chipInfo.useExtendedErase) {
    await ctx.sendCommand(CMD_EXTENDED_ERASE);
    const numPages = sectorList.length;
    const data = new Uint8Array(2 + numPages * 2);
    data[0] = ((numPages - 1) >> 8) & 0xff;
    data[1] = (numPages - 1) & 0xff;
    for (let i = 0; i < numPages; i++) {
      data[2 + i * 2] = (sectorList[i] >> 8) & 0xff;
      data[2 + i * 2 + 1] = sectorList[i] & 0xff;
    }
    await ctx.sendBytes(withXorChecksum(data));
    await ctx.waitForAck(ERASE_TIMEOUT);
    return;
  }

  if (sectorList.some((p) => p > 0xff)) {
    throw new Error("Legacy erase cannot address pages above 255; this chip needs extended erase");
  }
  for (let start = 0; start < sectorList.length; start += LEGACY_ERASE_MAX_PAGES) {
    ctx.checkAbort();
    const batch = sectorList.slice(start, start + LEGACY_ERASE_MAX_PAGES);
    await ctx.sendCommand(CMD_ERASE);
    const data = new Uint8Array(1 + batch.length);
    data[0] = batch.length - 1;
    batch.forEach((p, i) => { data[1 + i] = p; });
    await ctx.sendBytes(withXorChecksum(data));
    await ctx.waitForAck(ERASE_TIMEOUT);
  }
}

function withXorChecksum(data: Uint8Array): Uint8Array {
  let checksum = 0;
  for (const b of data) checksum ^= b;
  const payload = new Uint8Array(data.length + 1);
  payload.set(data);
  payload[data.length] = checksum;
  return payload;
}

/** Write firmware blocks to flash. */
export async function writeFlash(
  ctx: SerialFlashContext,
  blocks: ParsedFirmware["blocks"],
  onProgress: FlashProgressCallback,
): Promise<void> {
  const totalBytes = blocks.reduce((sum, b) => sum + b.data.length, 0);
  let writtenBytes = 0;

  for (const block of blocks) {
    let offset = 0;
    while (offset < block.data.length) {
      ctx.checkAbort();
      const chunkSize = Math.min(WRITE_BLOCK_SIZE, block.data.length - offset);
      const address = block.address + offset;
      const chunk = block.data.slice(offset, offset + chunkSize);

      await writeMemory(ctx, address, chunk);

      writtenBytes += chunkSize;
      offset += chunkSize;
      const percent = 25 + Math.round((writtenBytes / totalBytes) * 50);
      onProgress({
        phase: "flashing", percent,
        message: `Writing... ${writtenBytes}/${totalBytes} bytes`,
        bytesWritten: writtenBytes, bytesTotal: totalBytes,
        phasePercent: Math.round((writtenBytes / totalBytes) * 100),
      });
    }
  }
}

/**
 * WRITE_MEMORY command -- write up to 256 bytes at an address. AN3155 needs
 * the byte count to be a multiple of 4, so the tail is padded with erased
 * flash (0xFF).
 */
async function writeMemory(ctx: SerialFlashContext, address: number, data: Uint8Array): Promise<void> {
  await ctx.sendCommand(CMD_WRITE_MEMORY);
  await ctx.sendAddress(address);

  const rem = data.length % 4;
  const padded = new Uint8Array(data.length + (rem === 0 ? 0 : 4 - rem));
  padded.fill(0xff);
  padded.set(data);

  const payload = new Uint8Array(1 + padded.length + 1);
  payload[0] = padded.length - 1;
  payload.set(padded, 1);

  let checksum = payload[0];
  for (let i = 0; i < padded.length; i++) checksum ^= padded[i];
  payload[payload.length - 1] = checksum;

  await ctx.sendBytes(payload);
  await ctx.waitForAck();
}

/** READ_MEMORY command -- read up to 256 bytes from an address. */
export async function readFlash(ctx: SerialFlashContext, address: number, length: number): Promise<Uint8Array> {
  await ctx.sendCommand(CMD_READ_MEMORY);
  await ctx.sendAddress(address);
  const n = length - 1;
  await ctx.sendBytes(new Uint8Array([n, ~n & 0xff]));
  await ctx.waitForAck();
  return new Uint8Array(await ctx.waitForBytes(length));
}

/** GO command -- jump to address and start executing. */
export async function jumpToApp(ctx: SerialFlashContext, address: number): Promise<void> {
  try {
    await ctx.sendCommand(CMD_GO);
    await ctx.sendAddress(address);
  } catch {
    // Expected -- device resets after GO command
  }
}
