/**
 * DFU flash operations: layout check, erase, write, and verify.
 *
 * Extracted from STM32DfuFlasher for file size.
 *
 * @module protocol/firmware/stm32-dfu-flash
 */

import type { FlashProgressCallback, ParsedFirmware, DfuFlashLayout } from "./types";

export interface DfuFlashContext {
  transferSize: number;
  flashLayout: DfuFlashLayout;
  erasePage(address: number): Promise<void>;
  loadAddress(address: number): Promise<void>;
  writeBlock(blockNum: number, data: Uint8Array): Promise<void>;
  readBlock(blockNum: number, length: number): Promise<Uint8Array>;
  /** DFU_ABORT back to dfuIDLE; required between SET_ADDRESS and UPLOAD. */
  abortToIdle(): Promise<void>;
  checkAbort(): void;
}

/** DfuSe sector property letter → bitmask (a=readable, b=erasable, d=writable; combinations up to g). */
const DFUSE_ERASABLE = 0x2;
const DFUSE_WRITABLE = 0x4;

function sectorFlags(properties: string): number {
  const code = properties.toLowerCase().charCodeAt(0) - "a".charCodeAt(0) + 1;
  return code >= 1 && code <= 7 ? code : 0;
}

function hexAddr(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Sector start addresses to erase for the image. Every byte of every block
 * must fall inside a sector the layout marks erasable and writable; anything
 * else (an image built for another chip, or a protected region) is refused
 * before the board is touched.
 */
export function dfuSectorsToErase(layout: DfuFlashLayout, firmware: ParsedFirmware): number[] {
  const toErase = new Set<number>();
  for (const block of firmware.blocks) {
    const blockEnd = block.address + block.data.length;
    let covered = block.address;
    for (const sector of layout.sectors) {
      const flags = sectorFlags(sector.properties);
      for (let i = 0; i < sector.count; i++) {
        const sectorAddr = sector.address + i * sector.size;
        const sectorEnd = sectorAddr + sector.size;
        if (sectorAddr >= blockEnd || sectorEnd <= block.address) continue;
        if ((flags & DFUSE_ERASABLE) === 0 || (flags & DFUSE_WRITABLE) === 0) {
          throw new Error(`Firmware writes to a protected flash sector at ${hexAddr(sectorAddr)} (${layout.name})`);
        }
        toErase.add(sectorAddr);
        if (sectorAddr <= covered && sectorEnd > covered) covered = sectorEnd;
      }
    }
    if (covered < blockEnd) {
      throw new Error(
        `Firmware range ${hexAddr(block.address)}-${hexAddr(blockEnd - 1)} is outside the device flash (${layout.name}). Check that the image matches this board.`,
      );
    }
  }
  return Array.from(toErase).sort((a, b) => a - b);
}

export async function dfuErasePages(ctx: DfuFlashContext, firmware: ParsedFirmware, onProgress: FlashProgressCallback): Promise<void> {
  const sectorsToErase = dfuSectorsToErase(ctx.flashLayout, firmware);
  for (let i = 0; i < sectorsToErase.length; i++) {
    ctx.checkAbort();
    await ctx.erasePage(sectorsToErase[i]);
    onProgress({
      phase: "erasing", percent: 15 + Math.round(((i + 1) / sectorsToErase.length) * 10),
      message: `Erasing sector ${i + 1}/${sectorsToErase.length} at 0x${sectorsToErase[i].toString(16)}`,
      phasePercent: Math.round(((i + 1) / sectorsToErase.length) * 100),
    });
  }
}

export async function dfuWriteBlocks(ctx: DfuFlashContext, firmware: ParsedFirmware, onProgress: FlashProgressCallback): Promise<void> {
  const totalBytes = firmware.totalBytes;
  let writtenBytes = 0;
  for (const block of firmware.blocks) {
    await ctx.loadAddress(block.address);
    let offset = 0;
    let blockNum = 2;
    while (offset < block.data.length) {
      ctx.checkAbort();
      const chunkSize = Math.min(ctx.transferSize, block.data.length - offset);
      await ctx.writeBlock(blockNum, block.data.slice(offset, offset + chunkSize));
      writtenBytes += chunkSize;
      offset += chunkSize;
      blockNum++;
      onProgress({
        phase: "flashing", percent: 25 + Math.round((writtenBytes / totalBytes) * 50),
        message: `Writing... ${writtenBytes}/${totalBytes} bytes`,
        bytesWritten: writtenBytes, bytesTotal: totalBytes,
        phasePercent: Math.round((writtenBytes / totalBytes) * 100),
      });
    }
  }
}

/**
 * Read every block back and compare. DfuSe accepts UPLOAD only from dfuIDLE /
 * dfuUPLOAD_IDLE, so each block does ABORT → SET_ADDRESS → ABORT → UPLOAD,
 * the same sequence dfu-util uses.
 */
export async function dfuVerifyBlocks(ctx: DfuFlashContext, firmware: ParsedFirmware, onProgress: FlashProgressCallback): Promise<void> {
  const totalBytes = firmware.totalBytes;
  let verifiedBytes = 0;
  for (const block of firmware.blocks) {
    await ctx.abortToIdle();
    await ctx.loadAddress(block.address);
    await ctx.abortToIdle();
    let offset = 0;
    let blockNum = 2;
    while (offset < block.data.length) {
      ctx.checkAbort();
      const chunkSize = Math.min(ctx.transferSize, block.data.length - offset);
      const readData = await ctx.readBlock(blockNum, chunkSize);
      for (let i = 0; i < chunkSize; i++) {
        if (readData[i] !== block.data[offset + i]) {
          throw new Error(`Verification failed at 0x${(block.address + offset + i).toString(16).toUpperCase()}`);
        }
      }
      verifiedBytes += chunkSize;
      offset += chunkSize;
      blockNum++;
      onProgress({
        phase: "verifying", percent: 75 + Math.round((verifiedBytes / totalBytes) * 20),
        message: `Verifying... ${verifiedBytes}/${totalBytes} bytes`,
        bytesWritten: verifiedBytes, bytesTotal: totalBytes,
        phasePercent: Math.round((verifiedBytes / totalBytes) * 100),
      });
    }
  }
}
