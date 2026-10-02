/**
 * @license GPL-3.0-only
 *
 * Wire-level behaviour of the FC flashing paths: the PX4-protocol bootloader
 * handshake and CRC, APJ image decoding, DFU error handling, image/method
 * refusals, the ST ROM sector map and the rockusb command block layout.
 */

import { describe, it, expect, vi } from "vitest";
import pako from "pako";

import { PX4SerialFlasher } from "../px4-serial";
import { PX4_BL, px4BootloaderCrc, padToWord } from "../px4-serial-helpers";
import { parseApjFile } from "../apj-parser";
import { parseHexFile } from "../hex-parser";
import { STM32DfuFlasher } from "../stm32-dfu";
import { flashRefusal, USB_REQUIRED_MESSAGE } from "../flash-manager";
import { WITH_BL_REQUIRED_MESSAGE, type ParsedFirmware } from "../types";
import { CHIP_TABLE, sectorIndicesFor } from "../stm32-chip-table";
import { buildRockusbCbw, lbaCommandBlock } from "../rockchip-bootrom";

function apjFixture(image: Uint8Array, imageSize = image.length): string {
  const compressed = pako.deflate(image);
  let bin = "";
  for (const b of compressed) bin += String.fromCharCode(b);
  return JSON.stringify({ board_id: 140, image: btoa(bin), image_size: imageSize, summary: "fixture" });
}

describe("PX4-protocol bootloader", () => {
  it("reads the board id with GET_DEVICE carrying the INFO_BOARD_ID selector", async () => {
    const flasher = new PX4SerialFlasher({} as SerialPort);
    const write = vi.fn(async (_data: Uint8Array) => undefined);
    Object.assign(flasher, {
      writer: { write },
      pumpActive: true,
      // board id 140 (LE) followed by INSYNC OK
      readBuffer: [140, 0, 0, 0, PX4_BL.INSYNC, PX4_BL.OK],
    });
    const id = await (flasher as unknown as { getDeviceInfo(info: number): Promise<number> })
      .getDeviceInfo(PX4_BL.INFO_BOARD_ID);
    expect(Array.from(write.mock.calls[0][0])).toEqual([0x22, 0x02, 0x20]);
    expect(id).toBe(140);
  });

  it("computes GET_CRC the way the bootloader does: state 0, no final XOR", () => {
    const vector = new TextEncoder().encode("123456789");
    // vector length 9 is not word aligned, so compare with fwSize equal to its length.
    expect(px4BootloaderCrc(vector, vector.length)).toBe(0x2dfd2d88);
  });

  it("covers the erased flash past the image up to the reported size", () => {
    expect(px4BootloaderCrc(new Uint8Array([1, 2, 3, 4]), 8)).toBe(0xf69ae53a);
  });

  it("pads images to a whole word with erased bytes", () => {
    expect(Array.from(padToWord(new Uint8Array([1, 2, 3, 4, 5])))).toEqual([1, 2, 3, 4, 5, 0xff, 0xff, 0xff]);
  });
});

describe("APJ parser", () => {
  it("inflates the zlib image and checks it against image_size", () => {
    const image = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff);
    const fw = parseApjFile(apjFixture(image));
    expect(fw.blocks[0].data.length).toBe(1000);
    expect(Array.from(fw.blocks[0].data)).toEqual(Array.from(image));
    expect(fw.bootloaderApp).toBe(true);
    expect(fw.blocks[0].address).toBe(0);
    expect(fw.boardId).toBe(140);
  });

  it("refuses an image whose inflated size differs from image_size", () => {
    expect(() => parseApjFile(apjFixture(new Uint8Array(64), 65))).toThrow(/image_size/);
  });
});

describe("DFU", () => {
  it("treats dfuERROR as fatal instead of clearing it and reporting success", async () => {
    const status = new DataView(new Uint8Array([0x03, 0, 0, 0, 10, 0]).buffer); // errWRITE, dfuERROR
    const device = {
      controlTransferIn: vi.fn(async () => ({ status: "ok", data: status })),
      controlTransferOut: vi.fn(async () => ({ status: "ok", bytesWritten: 0 })),
    };
    const flasher = new STM32DfuFlasher(device as unknown as USBDevice);
    await expect(
      (flasher as unknown as { pollUntilIdle(ms: number): Promise<void> }).pollUntilIdle(1000),
    ).rejects.toThrow(/errWRITE/);
  });

  it("fails on a stalled control transfer", async () => {
    const device = {
      controlTransferIn: vi.fn(async () => ({ status: "stall", data: undefined })),
      controlTransferOut: vi.fn(async () => ({ status: "ok", bytesWritten: 0 })),
    };
    const flasher = new STM32DfuFlasher(device as unknown as USBDevice);
    await expect(
      (flasher as unknown as { pollUntilIdle(ms: number): Promise<void> }).pollUntilIdle(1000),
    ).rejects.toThrow(/stall/);
  });
});

describe("flashRefusal", () => {
  const appImage: ParsedFirmware = { blocks: [{ address: 0, data: new Uint8Array(8) }], totalBytes: 8, bootloaderApp: true };
  const absolute: ParsedFirmware = { blocks: [{ address: 0x08000000, data: new Uint8Array(8) }], totalBytes: 8 };
  const connected = { isConnected: true };

  it("refuses a flight controller reached over a network link", () => {
    expect(flashRefusal(connected, { type: "websocket" }, appImage, "auto")).toBe(USB_REQUIRED_MESSAGE);
    expect(flashRefusal(connected, { type: "webserial" }, appImage, "auto")).toBeNull();
    expect(flashRefusal(null, null, appImage, "auto")).toBeNull();
  });

  it("never sends an application image through DFU or the ST ROM bootloader", () => {
    expect(flashRefusal(null, null, appImage, "dfu")).toBe(WITH_BL_REQUIRED_MESSAGE);
    expect(flashRefusal(null, null, appImage, "st-rom-serial")).toBe(WITH_BL_REQUIRED_MESSAGE);
    expect(flashRefusal(null, null, absolute, "dfu")).toBeNull();
  });

  it("never sends an absolute image through the PX4-protocol bootloader", () => {
    expect(flashRefusal(null, null, absolute, "px4-serial")).toMatch(/application image/);
  });
});

describe("ST ROM sector map", () => {
  it("maps F405 ranges onto its mixed-size sectors", () => {
    const f405 = CHIP_TABLE[0x413];
    expect(sectorIndicesFor(f405, 0x08000000, 200 * 1024)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sectorIndicesFor(f405, 0x08020000, 1)).toEqual([5]);
  });

  it("rejects a range past the end of flash", () => {
    expect(() => sectorIndicesFor(CHIP_TABLE[0x413], 0x080ff000, 0x2000)).toThrow(/outside/);
  });
});

describe("Intel HEX parser", () => {
  it("rejects overlapping data records", () => {
    const hex = [":0400000001020304F2", ":0400020005060708E0", ":00000001FF"].join("\n");
    expect(() => parseHexFile(hex)).toThrow(/overlapping/);
  });

  it("ignores records after EOF and keeps addresses above 0x7FFF0000 positive", () => {
    const hex = [":0200000490006A", ":0100000011EE", ":00000001FF", ":0100100022CD"].join("\n");
    const fw = parseHexFile(hex);
    expect(fw.blocks).toHaveLength(1);
    expect(fw.blocks[0].address).toBe(0x90000000);
  });
});

describe("rockusb command block", () => {
  it("puts the LBA at CBWCB[2..5] and the sector count at CBWCB[7..8], big-endian", () => {
    const cbw = buildRockusbCbw({
      tag: 1, transferLength: 256 * 512, direction: "out", opcode: 0x15,
      cb: lbaCommandBlock(0x01020304, 0x0100),
    });
    expect(cbw.length).toBe(31);
    expect(cbw[15]).toBe(0x15); // CBWCB[0] opcode
    expect(Array.from(cbw.subarray(17, 21))).toEqual([0x01, 0x02, 0x03, 0x04]); // CBWCB[2..5]
    expect(Array.from(cbw.subarray(22, 24))).toEqual([0x01, 0x00]); // CBWCB[7..8]
    expect(cbw[21]).toBe(0); // CBWCB[6] reserved
  });
});
