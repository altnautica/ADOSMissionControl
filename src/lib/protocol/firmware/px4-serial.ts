/**
 * PX4 bootloader protocol over USB serial via Web Serial API.
 *
 * Implements the PX4 bootloader protocol (px_uploader) for flashing
 * application images. ArduPilot's bootloader speaks the same protocol, so
 * .apj images flash through this path too. The bootloader writes the image
 * at its own application offset.
 *
 * Reference: PX4 bootloader uploader protocol (GET_SYNC / GET_DEVICE /
 * CHIP_ERASE / PROG_MULTI / GET_CRC / REBOOT over a CDC-ACM serial link).
 *
 * @module protocol/firmware/px4-serial
 */
/// <reference path="../web-serial.d.ts" />

import type {
  FirmwareFlasher,
  FlashMethod,
  FlashProgressCallback,
  FlashLogCallback,
  FlashRunOptions,
  ParsedFirmware,
} from "./types";
import { px4BootloaderCrc, PX4_BL, bootloaderAppImage } from "./px4-serial-helpers";
import { toHex } from "./hex";

export class PX4SerialFlasher implements FirmwareFlasher {
  readonly method: FlashMethod = "px4-serial";

  private port: SerialPort;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private aborted = false;
  private allowBoardIdMismatch = false;
  private onLog: FlashLogCallback | null = null;

  // Read pump: a single persistent reader loop drains into `readBuffer`.
  // `waitForBytes` polls the buffer against a deadline. This avoids racing a
  // fresh `read()` against a timeout per call, which would leak the losing
  // read() promise and corrupt framing of the next read.
  private readBuffer: number[] = [];
  private pumpActive = false;
  private dataWaiters: Array<() => void> = [];

  constructor(port: SerialPort, opts?: { allowBoardIdMismatch?: boolean }) {
    this.port = port;
    this.allowBoardIdMismatch = opts?.allowBoardIdMismatch ?? false;
  }

  static async requestPort(): Promise<SerialPort> {
    if (typeof navigator === "undefined" || !("serial" in navigator)) {
      throw new Error("Web Serial API not supported — use Chrome or Edge");
    }
    return navigator.serial.requestPort();
  }

  // ── Public Interface ───────────────────────────────────

  /**
   * Open the port and try a single GET_SYNC. On success the port is left OPEN
   * and synced (so `flash()` reuses it); on failure the port is fully closed.
   * Used by the orchestrator to (a) probe a reused handle on bridge boards and
   * (b) confirm a re-enumerated bootloader port on native-USB boards.
   */
  async trySync(timeoutMs = 2000, onLog?: FlashLogCallback): Promise<boolean> {
    if (onLog) this.onLog = onLog;
    try {
      await this.openPort();
    } catch (err) {
      this.log("debug", `port open failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    try {
      await this.syncOnce(timeoutMs);
      this.log("info", "PX4 bootloader responded to GET_SYNC");
      return true;
    } catch {
      await this.closePort();
      return false;
    }
  }

  async flash(
    firmware: ParsedFirmware,
    onProgress: FlashProgressCallback,
    signal?: AbortSignal,
    onLog?: FlashLogCallback,
    options?: FlashRunOptions,
  ): Promise<void> {
    this.aborted = false;
    if (onLog) this.onLog = onLog;
    if (signal) signal.addEventListener("abort", () => this.abort(), { once: true });

    try {
      // Refuse an absolute image before touching the board.
      const image = bootloaderAppImage(firmware);

      onProgress({ phase: "bootloader_init", percent: 5, message: "Opening serial port..." });
      await this.openPort();

      onProgress({ phase: "bootloader_init", percent: 8, message: "Synchronizing with PX4 bootloader..." });
      await this.sync();
      this.checkAbort();

      onProgress({ phase: "chip_detect", percent: 10, message: "Reading board ID..." });
      const boardId = await this.getDeviceInfo(PX4_BL.INFO_BOARD_ID);
      this.log("info", `board id reported: ${boardId}`);
      if (firmware.boardId !== undefined && boardId !== firmware.boardId) {
        const detail = `firmware expects board id ${firmware.boardId}, connected board reports ${boardId}`;
        if (this.allowBoardIdMismatch) {
          this.log("warning", `board id mismatch overridden — ${detail}`);
          onProgress({ phase: "chip_detect", percent: 12, message: `Board id mismatch (continuing): ${detail}` });
        } else {
          throw new Error(`Board ID mismatch: ${detail}. Pick the firmware that matches your board.`);
        }
      } else {
        onProgress({ phase: "chip_detect", percent: 12, message: `Board ID: ${boardId}` });
      }
      const fwSize = await this.getDeviceInfo(PX4_BL.INFO_FLASH_SIZE);
      this.log("info", `application area: ${fwSize} bytes`);
      if (image.length > fwSize) {
        throw new Error(`Firmware image (${image.length} bytes) is too large for this board (${fwSize} bytes available)`);
      }
      this.checkAbort();

      onProgress({ phase: "erasing", percent: 15, message: "Erasing flash (this may take a while)..." });
      await this.chipErase();
      onProgress({ phase: "erasing", percent: 25, message: "Erase complete" });
      this.checkAbort();

      await this.programFirmware(image, onProgress);
      this.checkAbort();

      // Verify (GET_CRC) runs here, before reboot() — the correct place, while
      // still in the bootloader. The board leaves the bootloader at reboot().
      if (options?.verify !== false) {
        onProgress({ phase: "verifying", percent: 85, message: "Verifying CRC32..." });
        await this.verifyCrc(image, fwSize);
        onProgress({ phase: "verifying", percent: 90, message: "CRC32 verified" });
        this.checkAbort();
      }
      onProgress({ phase: "restarting", percent: 95, message: "Rebooting flight controller..." });
      await this.reboot();

      onProgress({ phase: "done", percent: 100, message: "Flash complete!" });
    } finally {
      await this.closePort();
    }
  }

  abort(): void { this.aborted = true; }
  async dispose(): Promise<void> { await this.closePort(); }

  // ── Port Management ────────────────────────────────────

  private async openPort(): Promise<void> {
    if (this.reader && this.writer) return; // already open (e.g. after trySync)
    try {
      await this.port.open({ baudRate: 115200, parity: "none", stopBits: 1, dataBits: 8 });
    } catch (err) {
      // A successful trySync leaves the port open; a re-open then throws
      // InvalidStateError. Any other error is a genuinely dead handle.
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) throw err;
    }
    const info = this.port.getInfo?.();
    if (info && info.usbVendorId !== undefined) {
      this.log("info", `port opened ${hex4(info.usbVendorId)}:${hex4(info.usbProductId ?? 0)} @ 115200`);
    }
    this.readBuffer = [];
    if (this.port.readable && !this.reader) this.reader = this.port.readable.getReader();
    if (this.port.writable && !this.writer) this.writer = this.port.writable.getWriter();
    this.startReadPump();
  }

  private startReadPump(): void {
    if (this.pumpActive || !this.reader) return;
    this.pumpActive = true;
    void (async () => {
      try {
        while (this.pumpActive && this.reader) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length) {
            for (const b of value) this.readBuffer.push(b);
            this.wakeWaiters();
          }
        }
      } catch {
        /* reader cancelled or device removed */
      } finally {
        this.pumpActive = false;
        this.wakeWaiters();
      }
    })();
  }

  private wakeWaiters(): void {
    const waiters = this.dataWaiters;
    this.dataWaiters = [];
    for (const w of waiters) w();
  }

  private async closePort(): Promise<void> {
    this.pumpActive = false;
    try {
      if (this.reader) { await this.reader.cancel().catch(() => {}); this.reader.releaseLock(); this.reader = null; }
      if (this.writer) { await this.writer.close().catch(() => {}); this.writer.releaseLock(); this.writer = null; }
      await this.port.close().catch(() => {});
    } catch { /* Ignore close errors */ }
    this.wakeWaiters();
  }

  // ── PX4 Bootloader Protocol ────────────────────────────

  private async sync(): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await this.syncOnce(1000);
        return;
      } catch { await this.delay(100); }
    }
    throw new Error("Failed to synchronize with PX4 bootloader. Ensure the board is in bootloader mode.");
  }

  /** A single GET_SYNC round-trip (no retry loop). */
  private async syncOnce(timeoutMs: number): Promise<void> {
    this.readBuffer = [];
    await this.sendBytes(new Uint8Array([PX4_BL.GET_SYNC, PX4_BL.EOC]));
    await this.expectInsyncOk(timeoutMs);
  }

  /** GET_DEVICE with an info selector: `[GET_DEVICE, info, EOC]` → u32 LE + INSYNC OK. */
  private async getDeviceInfo(info: number): Promise<number> {
    await this.sendBytes(new Uint8Array([PX4_BL.GET_DEVICE, info, PX4_BL.EOC]));
    const bytes = await this.waitForBytes(4);
    await this.expectInsyncOk();
    return ((bytes[0]) | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  }

  private async chipErase(): Promise<void> {
    await this.sendBytes(new Uint8Array([PX4_BL.CHIP_ERASE, PX4_BL.EOC]));
    await this.expectInsyncOk(PX4_BL.ERASE_TIMEOUT);
  }

  private async programFirmware(data: Uint8Array, onProgress: FlashProgressCallback): Promise<void> {
    const totalBytes = data.length;
    let writtenBytes = 0;
    let nextLogAt = 0;
    for (let offset = 0; offset < totalBytes; offset += PX4_BL.PROG_MULTI_MAX) {
      this.checkAbort();
      const chunkSize = Math.min(PX4_BL.PROG_MULTI_MAX, totalBytes - offset);
      const chunk = data.slice(offset, offset + chunkSize);
      const packet = new Uint8Array(2 + chunkSize + 1);
      packet[0] = PX4_BL.PROG_MULTI;
      packet[1] = chunkSize;
      packet.set(chunk, 2);
      packet[packet.length - 1] = PX4_BL.EOC;
      await this.sendBytes(packet, { quiet: true });
      await this.expectInsyncOk();
      writtenBytes += chunkSize;
      // Log roughly every 64 KiB so the trace shows progress without flooding.
      if (writtenBytes >= nextLogAt) {
        this.log("debug", `programmed ${writtenBytes}/${totalBytes} bytes`);
        nextLogAt = writtenBytes + 65536;
      }
      const percent = 25 + Math.round((writtenBytes / totalBytes) * 55);
      onProgress({
        phase: "flashing", percent,
        message: `Writing... ${writtenBytes}/${totalBytes} bytes`,
        bytesWritten: writtenBytes, bytesTotal: totalBytes,
        phasePercent: Math.round((writtenBytes / totalBytes) * 100),
      });
    }
  }

  private async verifyCrc(image: Uint8Array, fwSize: number): Promise<void> {
    await this.sendBytes(new Uint8Array([PX4_BL.GET_CRC, PX4_BL.EOC]));
    const crcBytes = await this.waitForBytes(4, PX4_BL.ERASE_TIMEOUT);
    await this.expectInsyncOk();
    const remoteCrc = ((crcBytes[0]) | (crcBytes[1] << 8) | (crcBytes[2] << 16) | (crcBytes[3] << 24)) >>> 0;
    const localCrc = px4BootloaderCrc(image, fwSize);
    this.log("debug", `crc local 0x${localCrc.toString(16)} remote 0x${remoteCrc.toString(16)}`);
    if (remoteCrc !== localCrc) {
      throw new Error(`CRC32 mismatch: local 0x${localCrc.toString(16).padStart(8, "0")}, remote 0x${remoteCrc.toString(16).padStart(8, "0")}`);
    }
  }

  private async reboot(): Promise<void> {
    try { await this.sendBytes(new Uint8Array([PX4_BL.REBOOT, PX4_BL.EOC])); } catch { /* Device resets */ }
  }

  // ── Low-level Helpers ──────────────────────────────────

  private async sendBytes(data: Uint8Array, opts?: { quiet?: boolean }): Promise<void> {
    if (!this.writer) throw new Error("Serial port not open");
    if (!opts?.quiet) this.log("debug", `TX ${toHex(data)}`, toHex(data));
    await this.writer.write(data);
  }

  private async waitForBytes(count: number, timeoutMs: number = PX4_BL.DEFAULT_TIMEOUT): Promise<number[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.readBuffer.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Serial read timeout: expected ${count} bytes, got ${this.readBuffer.length}`);
      if (!this.pumpActive && this.readBuffer.length < count) {
        throw new Error("Serial read ended — device disconnected");
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.dataWaiters = this.dataWaiters.filter((w) => w !== waiter);
          resolve();
        }, Math.min(remaining, 1000));
        const waiter = () => { clearTimeout(timer); resolve(); };
        this.dataWaiters.push(waiter);
      });
    }
    return this.readBuffer.splice(0, count);
  }

  private async expectInsyncOk(timeoutMs: number = PX4_BL.DEFAULT_TIMEOUT): Promise<void> {
    const response = await this.waitForBytes(2, timeoutMs);
    if (response[0] !== PX4_BL.INSYNC) throw new Error(`PX4 bootloader: expected INSYNC (0x12), got 0x${response[0].toString(16)}`);
    if (response[1] === PX4_BL.FAILED) throw new Error("PX4 bootloader: operation FAILED");
    if (response[1] === PX4_BL.INVALID) throw new Error("PX4 bootloader: INVALID command");
    if (response[1] !== PX4_BL.OK) throw new Error(`PX4 bootloader: expected OK (0x10), got 0x${response[1].toString(16)}`);
  }

  private log(level: "debug" | "info" | "warning" | "error", message: string, rawHex?: string): void {
    this.onLog?.(level, message, rawHex);
  }

  private checkAbort(): void {
    if (this.aborted) throw new Error("Flash aborted by user");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}
