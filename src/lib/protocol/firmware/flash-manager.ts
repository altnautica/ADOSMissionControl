/**
 * Firmware flash orchestration layer.
 *
 * Coordinates the full flash workflow: parameter backup -> reboot to
 * bootloader -> detect bootloader -> erase -> flash -> verify -> reboot ->
 * parameter restore. Bridges the protocol layer with the low-level STM32
 * serial, PX4 serial, and DFU flashers.
 *
 * Native-USB flight controllers (STM32H7 boards) re-enumerate as a different
 * USB device when they drop into their bootloader. A USB-UART-bridge board
 * keeps the same port handle. The bootloader-acquisition step handles both:
 * it probes the existing handle first (bridge fast path), then waits for a
 * freshly-enumerated bootloader device (native USB), then falls back to a
 * user-gesture device picker.
 *
 * @module protocol/firmware/flash-manager
 */

import type {
  DroneProtocol,
  Transport,
  ParameterValue,
} from "../types";
import type {
  FlashOptions,
  FlashProgressCallback,
  FlashLogCallback,
  FlashUserAction,
  ParsedFirmware,
  FirmwareFlasher,
} from "./types";
import { STM32SerialFlasher } from "./stm32-serial";
import { STM32DfuFlasher } from "./stm32-dfu";
import { PX4SerialFlasher } from "./px4-serial";
import { serialPortManager } from "@/lib/serial-port-manager";
import {
  PX4_BOOTLOADER_IDS,
  ARDUPILOT_BOOTLOADER_IDS,
  toSerialFilters,
} from "@/lib/serial-bootloader-ids";

// ── Progress Phase Ranges ──────────────────────────────
//
// Backup:          0-5%
// Reboot:          5-6%
// Bootloader wait: 6-9%
// Bootloader init: 9-10%
// Erase:           10-25%
// Flash:           25-75%
// Verify:          75-95%
// Reboot+Restore:  95-100%

/** Max ms to wait for a re-enumerated bootloader device after reboot. */
const BOOTLOADER_POLL_MAX_MS = 20000;
/** Ms between DFU known-device polls. */
const DFU_POLL_INTERVAL_MS = 700;

// ── FlashManager ───────────────────────────────────────

export class FlashManager {
  private protocol: DroneProtocol | null;
  private transport: Transport | null;
  private abortController: AbortController | null = null;
  private flasher: FirmwareFlasher | null = null;
  private backedUpParams: ParameterValue[] | null = null;
  private onLog: FlashLogCallback | null = null;
  private allowBoardIdMismatch = false;

  // Pause/resume for the user-gesture device pickers. The recovery flow blocks
  // on these resolvers; the UI button handler calls selectBootloaderManually,
  // which runs the picker INSIDE the click gesture and settles the resolver.
  private pendingSerialResolver: ((port: SerialPort) => void) | null = null;
  private pendingUsbResolver: ((device: USBDevice) => void) | null = null;

  constructor(protocol: DroneProtocol | null, transport: Transport | null) {
    this.protocol = protocol;
    this.transport = transport;
  }

  /**
   * Execute the full firmware flash workflow.
   */
  async flash(
    firmware: ParsedFirmware,
    options: FlashOptions,
    onProgress: FlashProgressCallback,
    onLog?: FlashLogCallback,
  ): Promise<void> {
    if (options.method === "dronecan-ota") {
      throw new Error(
        "DroneCAN OTA flashes run through the AP_Periph flow (DroneCanOtaOrchestrator " +
          "over a live DroneCAN bus). FlashManager's bootloader-poll path does not own the CAN bus.",
      );
    }
    this.onLog = onLog ?? null;
    this.allowBoardIdMismatch = options.allowBoardIdMismatch ?? false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      // ── Step 1: Backup parameters ────────────────────
      if (options.backupParams && this.protocol?.isConnected) {
        onProgress({ phase: "backup", percent: 1, message: "Backing up parameters..." });
        this.backedUpParams = await this.backupParameters();
        onProgress({
          phase: "backup",
          percent: 5,
          message: `Backed up ${this.backedUpParams.length} parameters`,
        });
        this.log("info", `backed up ${this.backedUpParams.length} parameters`);
      }

      this.checkAbort(signal);

      // ── Step 2: Reboot to bootloader ─────────────────
      if (this.protocol?.isConnected) {
        onProgress({ phase: "rebooting", percent: 5, message: "Sending reboot-to-bootloader command..." });
        await this.rebootToBootloader();
        onProgress({ phase: "rebooting", percent: 6, message: "FC is rebooting into bootloader mode..." });
        this.log("info", "sent reboot-to-bootloader");
      }

      this.checkAbort(signal);

      // ── Step 3: Wait for and detect bootloader ───────
      // Capture (without disconnecting) the app's serial port so we can probe
      // it on a bridge board; then disconnect the live transport so the port
      // can be reopened with bootloader settings.
      const existingPort = this.releaseTransportPort();
      if (existingPort) {
        await this.transport!.disconnect();
      }

      this.flasher = await this.waitForBootloader(
        options.method,
        existingPort,
        onProgress,
        signal,
      );

      this.checkAbort(signal);

      // ── Step 4: Flash firmware ───────────────────────
      // The flasher erases, writes, verifies (read-back, while still in the
      // bootloader), then leaves the bootloader / reboots into the new firmware
      // as its final step. Verification cannot happen after that reboot — the
      // bootloader is gone and the device disconnects — so it lives inside
      // flash(), gated by the verify option, not in a separate pass here.
      await this.flasher.flash(firmware, onProgress, signal, this.onLog ?? undefined, { verify: options.verify });

      this.checkAbort(signal);

      // ── Step 5: Restore parameters ───────────────────
      if (this.backedUpParams && this.backedUpParams.length > 0) {
        onProgress({ phase: "restoring", percent: 96, message: "Waiting for firmware to boot..." });
        await this.delay(5000); // Wait for FC to boot new firmware

        onProgress({
          phase: "restoring",
          percent: 97,
          message: `Restoring ${this.backedUpParams.length} parameters...`,
        });
        await this.restoreParameters(this.backedUpParams, onProgress);
      }

      onProgress({ phase: "done", percent: 100, message: "Firmware update complete!" });
      this.log("info", "firmware update complete");
    } catch (err) {
      if (signal.aborted) {
        onProgress({ phase: "error", percent: 0, message: "Flash aborted by user" });
      } else {
        const message = err instanceof Error ? err.message : "Unknown flash error";
        onProgress({ phase: "error", percent: 0, message });
        this.log("error", message);
      }
      throw err;
    } finally {
      if (this.flasher) {
        await this.flasher.dispose().catch(() => {});
        this.flasher = null;
      }
      this.pendingSerialResolver = null;
      this.pendingUsbResolver = null;
    }
  }

  /** Cancel an in-progress flash operation. */
  abort(): void {
    this.abortController?.abort();
    this.flasher?.abort();
  }

  /**
   * Resolve a pending "select device" action from a user click. Runs the
   * browser device picker INSIDE the gesture (the browser requires this) and
   * feeds the chosen device back into the paused recovery flow. Rejects if the
   * user cancels the picker, leaving the action pending so the button can be
   * clicked again.
   */
  async selectBootloaderManually(action: FlashUserAction): Promise<void> {
    if (action.kind === "select-bootloader") {
      if (!this.pendingSerialResolver) return;
      const filters = action.filters ? toSerialFilters(action.filters) : undefined;
      const port = await navigator.serial.requestPort(filters ? { filters } : undefined);
      this.pendingSerialResolver(port);
      return;
    }
    if (action.kind === "select-dfu") {
      if (!this.pendingUsbResolver) return;
      const device = await STM32DfuFlasher.requestDevice();
      this.pendingUsbResolver(device);
      return;
    }
  }

  // ── Workflow Steps ─────────────────────────────────────

  private async backupParameters(): Promise<ParameterValue[]> {
    if (!this.protocol) return [];
    try {
      return await this.protocol.getAllParameters();
    } catch (err) {
      console.warn("Parameter backup failed:", err);
      return [];
    }
  }

  private async rebootToBootloader(): Promise<void> {
    if (!this.protocol) return;
    try {
      await this.protocol.rebootToBootloader();
    } catch {
      // FC may disconnect immediately — that's expected
    }
  }

  /** Get the SerialPort from the transport (if serial-based), else null. */
  private releaseTransportPort(): SerialPort | null {
    if (this.transport && "getPort" in this.transport) {
      return (this.transport as { getPort(): SerialPort | null }).getPort();
    }
    return null;
  }

  /**
   * Acquire a flasher bound to the board's bootloader, surviving native-USB
   * re-enumeration.
   */
  private async waitForBootloader(
    method: "serial" | "dfu" | "auto" | "px4-serial",
    existingPort: SerialPort | null,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<FirmwareFlasher> {
    if (method === "px4-serial") {
      return this.waitForPx4Bootloader(existingPort, onProgress, signal);
    }

    const knownBefore = await serialPortManager.snapshotKnownPorts();
    // Give the FC a moment to begin rebooting before we probe / poll.
    await this.delay(1500);

    // ── DFU (native-USB boards): already-permitted devices need no gesture ──
    if (method !== "serial" && STM32DfuFlasher.isSupported()) {
      const dfu = await this.pollForDfu(onProgress, signal);
      if (dfu) {
        onProgress({ phase: "bootloader_init", percent: 9, message: `DFU bootloader detected: ${dfu.label}` });
        this.log("info", `DFU bootloader detected: ${dfu.label}`);
        return new STM32DfuFlasher(dfu.device);
      }
    }

    // ── Serial: bridge fast path, then native re-enumeration recovery ──
    if (method !== "dfu") {
      if (existingPort && await this.probeBootloaderSync(existingPort)) {
        onProgress({ phase: "bootloader_init", percent: 9, message: "Serial bootloader detected" });
        this.log("info", "serial bootloader detected on existing port (bridge board)");
        return new STM32SerialFlasher(existingPort);
      }
      this.log("info", "existing port did not respond — waiting for re-enumerated bootloader");
      const recovered = await serialPortManager.waitForBootloaderPort({
        knownBefore,
        ids: ARDUPILOT_BOOTLOADER_IDS,
        timeoutMs: BOOTLOADER_POLL_MAX_MS,
        signal,
        onTick: (ms) => onProgress({
          phase: "bootloader_wait",
          percent: 6 + Math.min(3, Math.round((ms / BOOTLOADER_POLL_MAX_MS) * 3)),
          message: `Waiting for bootloader... (${Math.round(ms / 1000)}s)`,
        }),
      });
      if (recovered && await this.probeBootloaderSync(recovered)) {
        onProgress({ phase: "bootloader_init", percent: 9, message: "Serial bootloader detected" });
        this.log("info", "serial bootloader detected on re-enumerated port");
        return new STM32SerialFlasher(recovered);
      }
    }

    // ── Fallback: ask the user to pick the device (a real click) ──
    if (method === "dfu") {
      const device = await this.waitForManualUsbSelect({ kind: "select-dfu" }, onProgress, signal);
      return new STM32DfuFlasher(device);
    }
    const port = await this.waitForManualSerialSelect(
      { kind: "select-bootloader", filters: [...ARDUPILOT_BOOTLOADER_IDS] },
      onProgress,
      signal,
    );
    return new STM32SerialFlasher(port);
  }

  /**
   * PX4 bootloader path. Bridge fast path (probe the existing handle) -> native
   * re-enumeration recovery -> user-gesture picker fallback.
   */
  private async waitForPx4Bootloader(
    existingPort: SerialPort | null,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<FirmwareFlasher> {
    const knownBefore = await serialPortManager.snapshotKnownPorts();
    await this.delay(1500);

    // Bridge fast path: probe the reused handle. trySync leaves it open+synced.
    if (existingPort) {
      onProgress({ phase: "bootloader_wait", percent: 7, message: "Detecting PX4 bootloader..." });
      const probe = new PX4SerialFlasher(existingPort, { allowBoardIdMismatch: this.allowBoardIdMismatch });
      if (await probe.trySync(2500, this.onLog ?? undefined)) {
        onProgress({ phase: "bootloader_init", percent: 9, message: "PX4 bootloader detected" });
        this.log("info", "PX4 bootloader detected on existing port (bridge board)");
        return probe;
      }
      await probe.dispose();
    }

    // Native USB: the device re-enumerated as a new bootloader device.
    this.log("info", "existing port did not respond — waiting for re-enumerated PX4 bootloader");
    const recovered = await serialPortManager.waitForBootloaderPort({
      knownBefore,
      ids: PX4_BOOTLOADER_IDS,
      timeoutMs: BOOTLOADER_POLL_MAX_MS,
      signal,
      onTick: (ms) => onProgress({
        phase: "bootloader_wait",
        percent: 6 + Math.min(3, Math.round((ms / BOOTLOADER_POLL_MAX_MS) * 3)),
        message: `Waiting for PX4 bootloader... (${Math.round(ms / 1000)}s)`,
      }),
    });
    if (recovered) {
      const f = new PX4SerialFlasher(recovered, { allowBoardIdMismatch: this.allowBoardIdMismatch });
      if (await f.trySync(3000, this.onLog ?? undefined)) {
        onProgress({ phase: "bootloader_init", percent: 9, message: "PX4 bootloader detected" });
        this.log("info", "PX4 bootloader detected on re-enumerated port");
        return f;
      }
      await f.dispose();
    }

    // Fallback: the bootloader is present but was never permission-granted.
    const port = await this.waitForManualSerialSelect(
      { kind: "select-bootloader", filters: [...PX4_BOOTLOADER_IDS] },
      onProgress,
      signal,
    );
    return new PX4SerialFlasher(port, { allowBoardIdMismatch: this.allowBoardIdMismatch });
  }

  /** Poll for an already-permitted DFU device for a few seconds. */
  private async pollForDfu(
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<{ device: USBDevice; label: string } | null> {
    const attempts = Math.ceil(BOOTLOADER_POLL_MAX_MS / DFU_POLL_INTERVAL_MS);
    for (let i = 0; i < attempts; i++) {
      this.checkAbort(signal);
      try {
        const known = await STM32DfuFlasher.getKnownDevices();
        if (known.length > 0) return { device: known[0].device, label: known[0].label };
      } catch {
        /* keep polling */
      }
      onProgress({
        phase: "bootloader_wait",
        percent: 6 + Math.min(3, Math.round(((i + 1) / attempts) * 3)),
        message: `Waiting for DFU device... (${Math.round(((i + 1) * DFU_POLL_INTERVAL_MS) / 1000)}s)`,
      });
      await this.delay(DFU_POLL_INTERVAL_MS);
    }
    return null;
  }

  /** Block until the user picks a serial bootloader device (a real click). */
  private waitForManualSerialSelect(
    action: FlashUserAction,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<SerialPort> {
    onProgress({
      phase: "bootloader_wait",
      percent: 9,
      message: "Your board rebooted into its bootloader as a new USB device. Click to select it.",
      action,
    });
    this.log("warning", "auto-detect failed — awaiting manual bootloader selection");
    return new Promise<SerialPort>((resolve, reject) => {
      const onAbort = () => { this.pendingSerialResolver = null; reject(new Error("Flash aborted by user")); };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingSerialResolver = (port) => {
        signal.removeEventListener("abort", onAbort);
        this.pendingSerialResolver = null;
        resolve(port);
      };
    });
  }

  /** Block until the user picks a DFU device (a real click). */
  private waitForManualUsbSelect(
    action: FlashUserAction,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<USBDevice> {
    onProgress({
      phase: "bootloader_wait",
      percent: 9,
      message: "DFU device not detected automatically. Click to select it (hold BOOT, replug USB).",
      action,
    });
    this.log("warning", "auto-detect failed — awaiting manual DFU selection");
    return new Promise<USBDevice>((resolve, reject) => {
      const onAbort = () => { this.pendingUsbResolver = null; reject(new Error("Flash aborted by user")); };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingUsbResolver = (device) => {
        signal.removeEventListener("abort", onAbort);
        this.pendingUsbResolver = null;
        resolve(device);
      };
    });
  }

  /**
   * Probe a serial port for STM32 bootloader presence.
   *
   * Opens with bootloader settings (115200, even parity), sends the 0x7F sync
   * byte, and checks for ACK (0x79) or echo (0x7F). Closes afterwards so the
   * STM32SerialFlasher can open it fresh.
   */
  private async probeBootloaderSync(port: SerialPort): Promise<boolean> {
    const SYNC = 0x7f;
    const ACK = 0x79;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    try {
      await port.open({ baudRate: 115200, parity: "even", stopBits: 1, dataBits: 8 });

      if (!port.readable || !port.writable) {
        await port.close().catch(() => {});
        return false;
      }

      reader = port.readable.getReader();
      writer = port.writable.getWriter();

      await writer.write(new Uint8Array([SYNC]));

      const response = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500)
        ),
      ]);

      if (response.value && response.value.length > 0) {
        const byte = response.value[0];
        if (byte === ACK || byte === SYNC) {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          reader = null;
          await writer.close().catch(() => {});
          writer.releaseLock();
          writer = null;
          await port.close().catch(() => {});
          return true;
        }
      }

      await reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = null;
      await writer.close().catch(() => {});
      writer.releaseLock();
      writer = null;
      await port.close().catch(() => {});
      return false;
    } catch {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (writer) { await writer.close().catch(() => {}); writer.releaseLock(); }
      await port.close().catch(() => {});
      return false;
    }
  }

  private async restoreParameters(
    params: ParameterValue[],
    onProgress: FlashProgressCallback,
  ): Promise<void> {
    if (!this.protocol?.isConnected) {
      onProgress({
        phase: "restoring",
        percent: 99,
        message: "FC not connected — reconnect and restore parameters manually from .param backup file",
      });
      return;
    }

    let restored = 0;
    let failed = 0;
    for (const param of params) {
      try {
        const result = await this.protocol.setParameter(param.name, param.value);
        if (result.success) restored++;
        else failed++;
      } catch {
        failed++;
      }
    }

    onProgress({
      phase: "restoring",
      percent: 99,
      message: `Restored ${restored} parameters${failed > 0 ? ` (${failed} failed)` : ""}`,
    });
  }

  // ── Helpers ────────────────────────────────────────────

  private log(level: "debug" | "info" | "warning" | "error", message: string): void {
    this.onLog?.(level, message);
  }

  private checkAbort(signal: AbortSignal): void {
    if (signal.aborted) throw new Error("Flash aborted by user");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
