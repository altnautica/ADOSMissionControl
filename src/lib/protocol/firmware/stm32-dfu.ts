/**
 * STM32 USB DFU v1.1 + DFuSe extensions via WebUSB API.
 *
 * For flight controllers that expose a native USB DFU interface (the STM32
 * system-memory bootloader on native-USB boards). DFU writes absolute
 * addresses, so it only takes absolute images (.hex, `_with_bl.hex`); an
 * .apj / .px4 application image is refused.
 *
 * Every control transfer is status-checked (WebUSB resolves a STALL as
 * `status: "stall"` rather than throwing), and any dfuERROR the device
 * reports is fatal. Erase covers only the sectors the image needs and only
 * when the device publishes its flash layout; there is no silent mass erase.
 *
 * @module protocol/firmware/stm32-dfu
 */

/// <reference path="../web-usb.d.ts" />

import type { FirmwareFlasher, FlashProgressCallback, FlashLogCallback, FlashRunOptions, ParsedFirmware, DfuFlashLayout } from "./types";
import { DFU_STATE, DFU_STATE_NAME, WITH_BL_REQUIRED_MESSAGE } from "./types";
import { usbDeviceManager, type UsbDeviceInfo } from "../../usb-device-manager";
import { getFlashLayout, getTransferSize } from "./stm32-dfu-descriptors";
import { dfuErasePages, dfuWriteBlocks, dfuVerifyBlocks, type DfuFlashContext } from "./stm32-dfu-flash";

const DFU_DNLOAD = 0x01;
const DFU_UPLOAD = 0x02;
const DFU_GETSTATUS = 0x03;
const DFU_CLRSTATUS = 0x04;
const DFU_ABORT = 0x06;
const DFUSE_CMD_SET_ADDRESS = 0x21;
const DFUSE_CMD_ERASE = 0x41;
const DEFAULT_TRANSFER_SIZE = 2048;
const DFU_TIMEOUT = 5000;
const ERASE_TIMEOUT = 30000;

/** DFU 1.1 bStatus names, for error messages. */
const DFU_STATUS_NAME: Record<number, string> = {
  0x00: "OK", 0x01: "errTARGET", 0x02: "errFILE", 0x03: "errWRITE", 0x04: "errERASE",
  0x05: "errCHECK_ERASED", 0x06: "errPROG", 0x07: "errVERIFY", 0x08: "errADDRESS",
  0x09: "errNOTDONE", 0x0a: "errFIRMWARE", 0x0b: "errVENDOR", 0x0c: "errUSBR",
  0x0d: "errPOR", 0x0e: "errUNKNOWN", 0x0f: "errSTALLEDPKT",
};

export class STM32DfuFlasher implements FirmwareFlasher {
  readonly method = "dfu" as const;
  private device: USBDevice;
  private interfaceNumber = 0;
  private transferSize = DEFAULT_TRANSFER_SIZE;
  private aborted = false;

  constructor(device: USBDevice) { this.device = device; }

  static isSupported(): boolean { return usbDeviceManager.isSupported(); }
  static async requestDevice(): Promise<USBDevice> { return usbDeviceManager.requestDevice(); }
  static async getKnownDevices(): Promise<UsbDeviceInfo[]> { return usbDeviceManager.getKnownDevices(); }

  private flashCtx(flashLayout: DfuFlashLayout): DfuFlashContext {
    return {
      transferSize: this.transferSize, flashLayout,
      erasePage: (a) => this.erasePage(a), loadAddress: (a) => this.loadAddress(a),
      writeBlock: (n, d) => this.writeBlock(n, d), readBlock: (n, l) => this.readBlock(n, l),
      abortToIdle: () => this.abortToIdle(),
      checkAbort: () => this.checkAbort(),
    };
  }

  async flash(firmware: ParsedFirmware, onProgress: FlashProgressCallback, signal?: AbortSignal, onLog?: FlashLogCallback, options?: FlashRunOptions): Promise<void> {
    // An application image at flash base would overwrite the bootloader.
    if (firmware.bootloaderApp) throw new Error(WITH_BL_REQUIRED_MESSAGE);
    this.aborted = false;
    if (signal) signal.addEventListener("abort", () => this.abort(), { once: true });
    try {
      onProgress({ phase: "bootloader_init", percent: 8, message: "Opening USB device..." });
      await this.openAndClaim();
      onProgress({ phase: "chip_detect", percent: 10, message: "Reading flash layout..." });
      const flashLayout = await getFlashLayout(this.device, this.interfaceNumber);
      if (!flashLayout) {
        // A mass erase would also wipe the configuration/parameter sectors.
        throw new Error("The DFU device did not report its flash layout, so the flash was not started (a mass erase would wipe stored settings).");
      }
      this.transferSize = await getTransferSize(this.device, DEFAULT_TRANSFER_SIZE);
      onProgress({ phase: "chip_detect", percent: 12, message: `Flash: ${flashLayout.name} (${(flashLayout.totalSize / 1024)}KB), transfer size: ${this.transferSize}` });
      await this.clearStatus();
      this.checkAbort();
      const ctx = this.flashCtx(flashLayout);
      onProgress({ phase: "erasing", percent: 15, message: "Erasing flash sectors..." });
      await dfuErasePages(ctx, firmware, onProgress);
      onProgress({ phase: "erasing", percent: 25, message: "Erase complete" });
      this.checkAbort();
      await dfuWriteBlocks(ctx, firmware, onProgress);
      this.checkAbort();
      // Verify (read back + compare) MUST run here, while still in DFU mode.
      // leave() below reboots the board out of the bootloader — the device
      // disconnects, so a post-leave read-back is impossible.
      if (options?.verify !== false) {
        await this.verifyWritten(ctx, firmware, onProgress, onLog);
        this.checkAbort();
      }
      onProgress({ phase: "restarting", percent: 95, message: "Leaving DFU mode..." });
      await this.leave(firmware.blocks[0]?.address ?? 0x08000000);
      onProgress({ phase: "done", percent: 100, message: "Flash complete!" });
    } finally { await this.releaseDevice(); }
  }

  /**
   * Read the written firmware back and compare it, in-place, before leave().
   * A byte mismatch is a hard failure. A device that refuses DFU_UPLOAD
   * (readout protection) is reported as unverified: every DNLOAD was already
   * status-checked, but the bytes were not compared.
   */
  private async verifyWritten(ctx: DfuFlashContext, firmware: ParsedFirmware, onProgress: FlashProgressCallback, onLog?: FlashLogCallback): Promise<void> {
    onProgress({ phase: "verifying", percent: 78, message: "Verifying firmware..." });
    try {
      await dfuVerifyBlocks(ctx, firmware, onProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.aborted || msg.includes("Verification failed at") || msg.includes("aborted")) throw err;
      onLog?.("warning", `read-back refused by the device (${msg}); the image is written but was not compared`);
      onProgress({ phase: "verifying", percent: 94, message: "Written, but the device refused read-back: not verified" });
    }
  }

  abort(): void { this.aborted = true; }
  async dispose(): Promise<void> { await this.releaseDevice(); }

  // ── USB Device Management ──────────────────────────────

  private async openAndClaim(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
    const iface = this.device.configuration?.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 0xfe && a.interfaceSubclass === 0x01));
    if (!iface) throw new Error("No DFU interface found on this USB device");
    this.interfaceNumber = iface.interfaceNumber;
    await this.device.claimInterface(this.interfaceNumber);
    const flashAlt = iface.alternates.find((a) => a.interfaceClass === 0xfe && a.interfaceSubclass === 0x01 && (a.interfaceName?.includes("Flash") || a.interfaceName?.includes("@Internal")))
      ?? iface.alternates.find((a) => a.interfaceClass === 0xfe && a.interfaceSubclass === 0x01);
    if (flashAlt) await this.device.selectAlternateInterface(this.interfaceNumber, flashAlt.alternateSetting);
  }

  private async releaseDevice(): Promise<void> {
    try { if (this.device.opened) { await this.device.releaseInterface(this.interfaceNumber).catch(() => {}); await this.device.close().catch(() => {}); } } catch { /* Ignore */ }
  }

  // ── Checked control transfers ──────────────────────────

  private async controlOut(request: number, value: number, data?: Uint8Array): Promise<void> {
    const setup = { requestType: "class" as const, recipient: "interface" as const, request, value, index: this.interfaceNumber };
    const r = data ? await this.device.controlTransferOut(setup, data) : await this.device.controlTransferOut(setup);
    if (r.status !== "ok") throw new Error(`DFU request 0x${request.toString(16)} failed: ${r.status}`);
  }

  private async controlIn(request: number, value: number, length: number): Promise<DataView> {
    const r = await this.device.controlTransferIn({ requestType: "class", recipient: "interface", request, value, index: this.interfaceNumber }, length);
    if (r.status !== "ok" || !r.data) throw new Error(`DFU request 0x${request.toString(16)} failed: ${r.status}`);
    return r.data;
  }

  // ── DFU Protocol Operations ────────────────────────────

  private async getStatus(): Promise<{ status: number; pollTimeout: number; state: number }> {
    const d = await this.controlIn(DFU_GETSTATUS, 0, 6);
    if (d.byteLength < 6) throw new Error("Invalid DFU_GETSTATUS response");
    return { status: d.getUint8(0), pollTimeout: d.getUint8(1) | (d.getUint8(2) << 8) | (d.getUint8(3) << 16), state: d.getUint8(4) };
  }

  /** Bring a device left in any state by an earlier session back to dfuIDLE before starting. */
  private async clearStatus(): Promise<void> {
    await this.controlOut(DFU_CLRSTATUS, 0);
    for (let i = 0; i < 10; i++) {
      const s = await this.getStatus();
      if (s.state === DFU_STATE.dfuIDLE) return;
      if (s.state === DFU_STATE.dfuERROR) await this.controlOut(DFU_CLRSTATUS, 0);
      else await this.controlOut(DFU_ABORT, 0);
      await this.delay(s.pollTimeout || 100);
    }
    throw new Error("Failed to reach dfuIDLE state");
  }

  private async dfuseCommand(cmd: number, address: number, timeoutMs: number): Promise<void> {
    const d = new Uint8Array([cmd, address & 0xff, (address >>> 8) & 0xff, (address >>> 16) & 0xff, (address >>> 24) & 0xff]);
    await this.controlOut(DFU_DNLOAD, 0, d);
    await this.pollUntilIdle(timeoutMs);
  }

  private async loadAddress(address: number): Promise<void> {
    await this.dfuseCommand(DFUSE_CMD_SET_ADDRESS, address, DFU_TIMEOUT);
  }

  private async erasePage(address: number): Promise<void> {
    await this.dfuseCommand(DFUSE_CMD_ERASE, address, ERASE_TIMEOUT);
  }

  private async writeBlock(blockNum: number, data: Uint8Array): Promise<void> {
    await this.controlOut(DFU_DNLOAD, blockNum, data);
    await this.pollUntilIdle(DFU_TIMEOUT);
  }

  private async readBlock(blockNum: number, length: number): Promise<Uint8Array> {
    const d = await this.controlIn(DFU_UPLOAD, blockNum, length);
    if (d.byteLength !== length) throw new Error(`DFU_UPLOAD returned ${d.byteLength} of ${length} bytes`);
    return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  }

  private async leave(startAddress: number): Promise<void> {
    // After a read-back the device sits in dfuUPLOAD_IDLE, where DNLOAD is refused.
    await this.abortToIdle();
    await this.loadAddress(startAddress);
    try {
      await this.device.controlTransferOut({ requestType: "class", recipient: "interface", request: DFU_DNLOAD, value: 0, index: this.interfaceNumber });
      await this.getStatus().catch(() => {});
    } catch { /* Expected — device resets */ }
  }

  /**
   * DFU_ABORT back to dfuIDLE. Needed after SET_ADDRESS (dfuDNLOAD_IDLE) before
   * DFU_UPLOAD, and after an upload before the next SET_ADDRESS. A dfuERROR
   * here is fatal like everywhere else.
   */
  private async abortToIdle(): Promise<void> {
    await this.controlOut(DFU_ABORT, 0);
    for (let i = 0; i < 10; i++) {
      const s = await this.getStatus();
      if (s.state === DFU_STATE.dfuIDLE) return;
      if (s.state === DFU_STATE.dfuERROR) await this.failFromError(s.status);
      await this.delay(s.pollTimeout || 50);
    }
    throw new Error("Failed to reach dfuIDLE");
  }

  /** Clear the error so the device stays usable, then fail the operation with the device's status. */
  private async failFromError(status: number): Promise<never> {
    await this.controlOut(DFU_CLRSTATUS, 0).catch(() => {});
    throw new Error(`DFU device reported an error: ${DFU_STATUS_NAME[status] ?? `status ${status}`}`);
  }

  /**
   * Poll GETSTATUS until the device finishes the last DNLOAD. Success only in
   * dfuDNLOAD_IDLE / dfuIDLE; dfuERROR (errTARGET, errWRITE, errERASE, ...) is
   * always fatal, and a device still busy at the deadline is a timeout.
   */
  private async pollUntilIdle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const s = await this.getStatus();
      if (s.state === DFU_STATE.dfuERROR) await this.failFromError(s.status);
      if (s.state === DFU_STATE.dfuDNLOAD_IDLE || s.state === DFU_STATE.dfuIDLE) return;
      if (Date.now() >= deadline) {
        throw new Error(`DFU poll timeout in state ${DFU_STATE_NAME[s.state] ?? `unknown(${s.state})`}`);
      }
      await this.delay(Math.min(Math.max(s.pollTimeout, 50), 5000));
    }
  }

  private checkAbort(): void { if (this.aborted) throw new Error("Flash aborted by user"); }
  private delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}
