/**
 * STM32 chip signature table for serial bootloader identification.
 *
 * Maps chip signature IDs (from GET_ID command) to chip information,
 * including the real erase-sector map. Erase commands take sector (page)
 * indices, and F2/F4/F7 parts have mixed-size sectors, so an address range
 * must be mapped through the map rather than divided by one page size.
 *
 * @module protocol/firmware/stm32-chip-table
 */

import type { ChipInfo, ChipSectorRun } from "./types";

const F4_1M: ChipSectorRun[] = [{ count: 4, size: 16 * 1024 }, { count: 1, size: 64 * 1024 }, { count: 7, size: 128 * 1024 }];
const F4_512K: ChipSectorRun[] = [{ count: 4, size: 16 * 1024 }, { count: 1, size: 64 * 1024 }, { count: 3, size: 128 * 1024 }];

/** Chip signature to chip info lookup table. */
export const CHIP_TABLE: Record<number, Omit<ChipInfo, "signature">> = {
  0x410: { name: "STM32F103 Medium-density", flashSize: 128 * 1024, sectors: [{ count: 128, size: 1024 }], flashBase: 0x08000000, useExtendedErase: false },
  0x411: { name: "STM32F2xx", flashSize: 1024 * 1024, sectors: F4_1M, flashBase: 0x08000000, useExtendedErase: true },
  0x412: { name: "STM32F103 Low-density", flashSize: 32 * 1024, sectors: [{ count: 32, size: 1024 }], flashBase: 0x08000000, useExtendedErase: false },
  0x413: { name: "STM32F405/F407", flashSize: 1024 * 1024, sectors: F4_1M, flashBase: 0x08000000, useExtendedErase: true },
  0x414: { name: "STM32F103 High-density", flashSize: 512 * 1024, sectors: [{ count: 256, size: 2048 }], flashBase: 0x08000000, useExtendedErase: false },
  0x419: { name: "STM32F427/F429", flashSize: 2048 * 1024, sectors: [...F4_1M, ...F4_1M], flashBase: 0x08000000, useExtendedErase: true },
  0x421: { name: "STM32F446", flashSize: 512 * 1024, sectors: F4_512K, flashBase: 0x08000000, useExtendedErase: true },
  0x431: { name: "STM32F411", flashSize: 512 * 1024, sectors: F4_512K, flashBase: 0x08000000, useExtendedErase: true },
  0x433: { name: "STM32F401 (B/C)", flashSize: 256 * 1024, sectors: [{ count: 4, size: 16 * 1024 }, { count: 1, size: 64 * 1024 }, { count: 1, size: 128 * 1024 }], flashBase: 0x08000000, useExtendedErase: true },
  0x435: { name: "STM32L4xx", flashSize: 1024 * 1024, sectors: [{ count: 512, size: 2048 }], flashBase: 0x08000000, useExtendedErase: true },
  0x449: { name: "STM32F74x", flashSize: 1024 * 1024, sectors: [{ count: 4, size: 32 * 1024 }, { count: 1, size: 128 * 1024 }, { count: 3, size: 256 * 1024 }], flashBase: 0x08000000, useExtendedErase: true },
  0x450: { name: "STM32H743/H753", flashSize: 2048 * 1024, sectors: [{ count: 16, size: 128 * 1024 }], flashBase: 0x08000000, useExtendedErase: true },
  0x451: { name: "STM32F76x/F77x", flashSize: 2048 * 1024, sectors: [{ count: 4, size: 32 * 1024 }, { count: 1, size: 128 * 1024 }, { count: 7, size: 256 * 1024 }], flashBase: 0x08000000, useExtendedErase: true },
  0x452: { name: "STM32F72x/F73x", flashSize: 512 * 1024, sectors: F4_512K, flashBase: 0x08000000, useExtendedErase: true },
  0x480: { name: "STM32H7A3/H7B3", flashSize: 2048 * 1024, sectors: [{ count: 256, size: 8 * 1024 }], flashBase: 0x08000000, useExtendedErase: true },
  0x483: { name: "STM32H723/H725/H730/H733/H735", flashSize: 1024 * 1024, sectors: [{ count: 8, size: 128 * 1024 }], flashBase: 0x08000000, useExtendedErase: true },
};

/**
 * Sector indices covering `[address, address + length)`. Throws when any
 * byte of the range falls outside the chip's flash map.
 */
export function sectorIndicesFor(chip: Pick<ChipInfo, "name" | "sectors" | "flashBase">, address: number, length: number): number[] {
  const end = address + length;
  const indices: number[] = [];
  let index = 0;
  let sectorStart = chip.flashBase;
  for (const run of chip.sectors) {
    for (let i = 0; i < run.count; i++, index++) {
      const sectorEnd = sectorStart + run.size;
      if (sectorStart < end && sectorEnd > address) indices.push(index);
      sectorStart = sectorEnd;
    }
  }
  if (length <= 0 || address < chip.flashBase || end > sectorStart) {
    throw new Error(
      `Firmware range 0x${address.toString(16).toUpperCase()}-0x${(end - 1).toString(16).toUpperCase()} is outside the ${chip.name} flash`,
    );
  }
  return indices;
}
