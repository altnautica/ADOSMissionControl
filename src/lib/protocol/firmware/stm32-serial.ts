/**
 * STM32 ROM bootloader protocol over UART via Web Serial API.
 *
 * Implements the ST AN3155 / AN2606 serial bootloader protocol. This is the
 * chip's system-memory bootloader (BOOT0 strap, or a software jump into
 * system memory over a USB-UART bridge); it writes absolute addresses, so it
 * only takes absolute images (.hex, `_with_bl.hex`, raw .bin at flash base).
 * The ArduPilot / PX4 USB bootloaders do not speak this protocol.
 *
 * @module protocol/firmware/stm32-serial
 */

/// <reference path="../web-serial.d.ts" />

import type { FirmwareFlasher, FlashProgressCallback, FlashLogCallback, FlashRunOptions, ParsedFirmware, ChipInfo } from "./types";
import { WITH_BL_REQUIRED_MESSAGE } from "./types";
import { CHIP_TABLE } from "./stm32-chip-table";
import { eraseFlash, writeFlash, readFlash, jumpToApp, READ_BLOCK_SIZE, type SerialFlashContext } from "./stm32-serial-flash";

const ACK = 0x79;
const NACK = 0x1f;
const CMD_GET = 0x00;
const CMD_GET_ID = 0x02;
const CMD_EXTENDED_ERASE = 0x44;
const DEFAULT_TIMEOUT = 3000;

export class STM32SerialFlasher implements FirmwareFlasher {
  readonly method = "st-rom-serial" as const;
  private port: SerialPort;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private aborted = false;
  private chipInfo: ChipInfo | null = null;
  private supportsExtendedErase = false;
  private readBuffer: number[] = [];

  constructor(port: SerialPort) { this.port = port; }

  static async requestPort(): Promise<SerialPort> {
    if (typeof navigator === "undefined" || !("serial" in navigator)) throw new Error("Web Serial API not supported — use Chrome or Edge");
    return navigator.serial.requestPort();
  }

  /** Context object for delegated flash operations. */
  private get flashCtx(): SerialFlashContext {
    return {
      sendBytes: (d) => this.sendBytes(d),
      sendCommand: (c) => this.sendCommand(c),
      sendAddress: (a) => this.sendAddress(a),
      waitForAck: (t) => this.waitForAck(t),
      waitForBytes: (c, t) => this.waitForBytes(c, t),
      checkAbort: () => this.checkAbort(),
    };
  }

  async flash(firmware: ParsedFirmware, onProgress: FlashProgressCallback, signal?: AbortSignal, onLog?: FlashLogCallback, options?: FlashRunOptions): Promise<void> {
    // An application image written at flash base would overwrite the board's
    // bootloader with an app that expects to start past it.
    if (firmware.bootloaderApp) throw new Error(WITH_BL_REQUIRED_MESSAGE);
    this.aborted = false;
    if (signal) signal.addEventListener("abort", () => this.abort(), { once: true });
    try {
      onProgress({ phase: "bootloader_init", percent: 8, message: "Opening serial port..." });
      await this.openPort();
      onProgress({ phase: "bootloader_init", percent: 9, message: "Synchronizing with bootloader..." });
      await this.initBootloader();
      onProgress({ phase: "chip_detect", percent: 10, message: "Reading bootloader info..." });
      await this.getBootloaderInfo();
      const chipInfo = await this.getChipId();
      this.chipInfo = chipInfo;
      onProgress({ phase: "chip_detect", percent: 12, message: `Detected: ${chipInfo.name} (${(chipInfo.flashSize / 1024)}KB)` });
      this.checkAbort();
      onProgress({ phase: "erasing", percent: 15, message: "Erasing flash..." });
      await eraseFlash(this.flashCtx, chipInfo, this.supportsExtendedErase, firmware.blocks);
      onProgress({ phase: "erasing", percent: 25, message: "Erase complete" });
      this.checkAbort();
      await writeFlash(this.flashCtx, firmware.blocks, onProgress);
      this.checkAbort();
      // Verify (read back + compare) MUST run here, while still in the ROM
      // bootloader. jumpToApp() below starts the application, so a post-jump
      // read-back would have to re-sync a bootloader that is no longer running.
      if (options?.verify !== false) {
        await this.verifyWritten(firmware, onProgress, onLog);
        this.checkAbort();
      }
      onProgress({ phase: "restarting", percent: 95, message: "Launching firmware..." });
      await jumpToApp(this.flashCtx, firmware.blocks[0]?.address ?? 0x08000000);
      onProgress({ phase: "done", percent: 100, message: "Flash complete!" });
    } finally { await this.closePort(); }
  }

  /**
   * Read the written firmware back and compare it, in-place, before jumpToApp().
   * A byte mismatch is a hard failure. A transfer-level read-back error is
   * downgraded to a warning (the write was already ACKed block-by-block during
   * writeFlash), so it never turns an otherwise-good flash into a failure.
   */
  private async verifyWritten(firmware: ParsedFirmware, onProgress: FlashProgressCallback, onLog?: FlashLogCallback): Promise<void> {
    const totalBytes = firmware.totalBytes;
    let verifiedBytes = 0;
    try {
      for (const block of firmware.blocks) {
        let offset = 0;
        while (offset < block.data.length) {
          this.checkAbort();
          const chunkSize = Math.min(READ_BLOCK_SIZE, block.data.length - offset);
          const readData = await readFlash(this.flashCtx, block.address + offset, chunkSize);
          for (let i = 0; i < chunkSize; i++) {
            if (readData[i] !== block.data[offset + i]) {
              throw new Error(`Verification failed at 0x${(block.address + offset + i).toString(16).toUpperCase()}: expected 0x${block.data[offset + i].toString(16).padStart(2, "0")}, got 0x${readData[i].toString(16).padStart(2, "0")}`);
            }
          }
          verifiedBytes += chunkSize;
          offset += chunkSize;
          onProgress({
            phase: "verifying", percent: 75 + Math.round((verifiedBytes / totalBytes) * 20),
            message: `Verifying... ${verifiedBytes}/${totalBytes} bytes`,
            bytesWritten: verifiedBytes, bytesTotal: totalBytes,
            phasePercent: Math.round((verifiedBytes / totalBytes) * 100),
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.aborted || msg.includes("Verification failed at") || msg.includes("aborted")) throw err;
      onLog?.("warning", `read-back verification unavailable (${msg}); write confirmed by bootloader`);
    }
  }

  abort(): void { this.aborted = true; }
  async dispose(): Promise<void> { await this.closePort(); }

  // ── Port Management ────────────────────────────────────

  private async openPort(): Promise<void> {
    await this.port.open({ baudRate: 115200, parity: "even", stopBits: 1, dataBits: 8 });
    this.readBuffer = [];
    if (this.port.readable) this.reader = this.port.readable.getReader();
    if (this.port.writable) this.writer = this.port.writable.getWriter();
  }

  private async closePort(): Promise<void> {
    try {
      if (this.reader) { await this.reader.cancel().catch(() => {}); this.reader.releaseLock(); this.reader = null; }
      if (this.writer) { await this.writer.close().catch(() => {}); this.writer.releaseLock(); this.writer = null; }
      await this.port.close().catch(() => {});
    } catch { /* Ignore close errors */ }
  }

  // ── Bootloader Protocol ────────────────────────────────

  private async initBootloader(): Promise<void> {
    const SYNC = 0x7f;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.sendBytes(new Uint8Array([SYNC]));
      try {
        const response = await this.waitForBytes(1, 1000);
        if (response[0] === ACK || response[0] === SYNC) return;
      } catch { /* Timeout — retry */ }
    }
    throw new Error("Failed to synchronize with STM32 bootloader. Ensure board is in bootloader mode.");
  }

  private async getBootloaderInfo(): Promise<void> {
    await this.sendCommand(CMD_GET);
    const numBytes = (await this.waitForBytes(1))[0];
    const data = await this.waitForBytes(numBytes + 1);
    await this.waitForAck();
    this.supportsExtendedErase = data.includes(CMD_EXTENDED_ERASE);
  }

  private async getChipId(): Promise<ChipInfo> {
    await this.sendCommand(CMD_GET_ID);
    const numBytes = (await this.waitForBytes(1))[0];
    const idBytes = await this.waitForBytes(numBytes + 1);
    await this.waitForAck();
    const signature = (idBytes[0] << 8) | idBytes[1];
    const info = CHIP_TABLE[signature];
    if (!info) throw new Error(`Unknown STM32 chip signature: 0x${signature.toString(16).padStart(4, "0")}`);
    return { signature, ...info };
  }

  // ── Low-level Helpers ──────────────────────────────────

  private async sendBytes(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error("Serial port not open");
    await this.writer.write(data);
  }

  private async waitForBytes(count: number, timeoutMs = DEFAULT_TIMEOUT): Promise<number[]> {
    if (!this.reader) throw new Error("Serial port not open");
    const deadline = Date.now() + timeoutMs;
    while (this.readBuffer.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Serial read timeout: expected ${count} bytes, got ${this.readBuffer.length}`);
      const result = await Promise.race([
        this.reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) => setTimeout(() => resolve({ value: undefined, done: true }), remaining)),
      ]);
      if (result.value) for (const byte of result.value) this.readBuffer.push(byte);
      if (result.done && !result.value) throw new Error("Serial read timeout");
    }
    return this.readBuffer.splice(0, count);
  }

  private async waitForAck(timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    const response = await this.waitForBytes(1, timeoutMs);
    if (response[0] === NACK) throw new Error("NACK received from bootloader");
    if (response[0] !== ACK) throw new Error(`Unexpected response: 0x${response[0].toString(16)}`);
  }

  private async sendCommand(cmd: number): Promise<void> {
    await this.sendBytes(new Uint8Array([cmd, ~cmd & 0xff]));
    await this.waitForAck();
  }

  private async sendAddress(address: number): Promise<void> {
    const bytes = new Uint8Array([(address >> 24) & 0xff, (address >> 16) & 0xff, (address >> 8) & 0xff, address & 0xff]);
    await this.sendBytes(new Uint8Array([...bytes, bytes[0] ^ bytes[1] ^ bytes[2] ^ bytes[3]]));
    await this.waitForAck();
  }

  private checkAbort(): void { if (this.aborted) throw new Error("Flash aborted by user"); }
}
