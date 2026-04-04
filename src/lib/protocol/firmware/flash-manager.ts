/**
 * Firmware flash orchestration layer.
 *
 * Coordinates the full flash workflow: parameter backup → reboot to
 * bootloader → detect bootloader → erase → flash → verify → reboot →
 * parameter restore. Bridges the protocol layer with the low-level
 * STM32 serial and DFU flashers.
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
  FlashProgress,
  FlashProgressCallback,
  ParsedFirmware,
  FirmwareFlasher,
} from "./types";
import { STM32SerialFlasher } from "./stm32-serial";
import { STM32DfuFlasher } from "./stm32-dfu";
import { PX4SerialFlasher } from "./px4-serial";

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

/** Max seconds to poll for bootloader after reboot command. */
const BOOTLOADER_POLL_MAX_S = 10;
/** Milliseconds between bootloader poll attempts. */
const BOOTLOADER_POLL_INTERVAL_MS = 1000;

// ── FlashManager ───────────────────────────────────────

export class FlashManager {
  private protocol: DroneProtocol | null;
  private transport: Transport | null;
  private abortController: AbortController | null = null;
  private flasher: FirmwareFlasher | null = null;
  private backedUpParams: ParameterValue[] | null = null;

  constructor(protocol: DroneProtocol | null, transport: Transport | null) {
    this.protocol = protocol;
    this.transport = transport;
  }

  /**
   * Execute the full firmware flash workflow.
   *
   * @param firmware — Parsed firmware image to flash
   * @param options — Flash configuration (method, backup, verify)
   * @param onProgress — Progress callback
   */
  async flash(
    firmware: ParsedFirmware,
    options: FlashOptions,
    onProgress: FlashProgressCallback,
  ): Promise<void> {
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
      }

      this.checkAbort(signal);

      // ── Step 2: Reboot to bootloader ─────────────────
      if (this.protocol?.isConnected) {
        onProgress({ phase: "rebooting", percent: 5, message: "Sending reboot-to-bootloader command..." });
        await this.rebootToBootloader();
        onProgress({ phase: "rebooting", percent: 6, message: "FC is rebooting into bootloader mode..." });
      }

      this.checkAbort(signal);

      // ── Step 3: Wait for and detect bootloader ───────
      // Disconnect existing transport so the serial port can be
      // reopened with bootloader settings (even parity, etc.)
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
      // The flasher handles erase + write + progress internally
      await this.flasher.flash(firmware, onProgress, signal);

      this.checkAbort(signal);

      // ── Step 5: Verify (optional) ────────────────────
      if (options.verify) {
        onProgress({ phase: "verifying", percent: 75, message: "Verifying firmware..." });
        await this.flasher.verify(firmware, onProgress, signal);
      }

      // ── Step 6: Restore parameters ───────────────────
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
    } catch (err) {
      if (signal.aborted) {
        onProgress({ phase: "error", percent: 0, message: "Flash aborted by user" });
      } else {
        onProgress({
          phase: "error",
          percent: 0,
          message: err instanceof Error ? err.message : "Unknown flash error",
        });
      }
      throw err;
    } finally {
      // Clean up flasher
      if (this.flasher) {
        await this.flasher.dispose().catch(() => {});
        this.flasher = null;
      }
    }
  }

  /** Cancel an in-progress flash operation. */
  abort(): void {
    this.abortController?.abort();
    this.flasher?.abort();
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

  /**
   * Get the SerialPort reference from the transport (if any) without
   * disconnecting yet. Returns null if transport is not serial-based.
   */
  private releaseTransportPort(): SerialPort | null {
    if (this.transport && "getPort" in this.transport) {
      return (this.transport as { getPort(): SerialPort | null }).getPort();
    }
    return null;
  }

  /**
   * Poll for the bootloader to become available after a reboot command.
   *
   * Strategy (executed each poll iteration):
   * 1. Check for previously-permitted DFU devices (no user gesture needed)
   * 2. Try the existing serial port (same physical device, bootloader mode)
   * 3. Scan all permitted serial ports for a newly-appeared bootloader port
   *
   * If polling exhausts all attempts, falls back to a browser device picker
   * with a clear message explaining what to select.
   */
  private async waitForBootloader(
    method: "serial" | "dfu" | "auto" | "px4-serial",
    existingPort: SerialPort | null,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<FirmwareFlasher> {
    // PX4 serial has its own bootloader protocol
    if (method === "px4-serial") {
      return this.waitForPx4Bootloader(existingPort, onProgress, signal);
    }

    // Initial delay: give the FC a moment to start rebooting before we
    // begin polling. Most FCs take 1-2s to re-enumerate on USB.
    await this.delay(1500);

    for (let attempt = 0; attempt < BOOTLOADER_POLL_MAX_S; attempt++) {
      this.checkAbort(signal);

      const elapsed = attempt + 1;
      onProgress({
        phase: "bootloader_wait",
        percent: 6 + Math.round((elapsed / BOOTLOADER_POLL_MAX_S) * 3),
        message: `Waiting for bootloader... (${elapsed}s / ${BOOTLOADER_POLL_MAX_S}s)`,
      });

      // ── Check DFU (works for native-USB boards like H7) ──
      if (method !== "serial" && STM32DfuFlasher.isSupported()) {
        try {
          const knownDfu = await STM32DfuFlasher.getKnownDevices();
          if (knownDfu.length > 0) {
            onProgress({
              phase: "bootloader_init",
              percent: 9,
              message: `DFU bootloader detected: ${knownDfu[0].label}`,
            });
            return new STM32DfuFlasher(knownDfu[0].device);
          }
        } catch {
          // WebUSB query failed, continue polling
        }
      }

      // ── Check serial (works for UART-bridge boards) ──
      if (method !== "dfu") {
        // For UART-bridge FCs (most common), the bridge chip stays powered
        // during MCU reboot. The serial port remains visible but the MCU
        // switches from MAVLink to bootloader protocol on the same UART.
        // We can reuse the same SerialPort reference.
        const port = existingPort ?? await this.findPermittedSerialPort();
        if (port) {
          const synced = await this.probeBootloaderSync(port);
          if (synced) {
            onProgress({
              phase: "bootloader_init",
              percent: 9,
              message: "Serial bootloader detected",
            });
            return new STM32SerialFlasher(port);
          }
        }
      }

      await this.delay(BOOTLOADER_POLL_INTERVAL_MS);
    }

    // ── Polling exhausted — fall back to manual selection ──
    onProgress({
      phase: "bootloader_init",
      percent: 9,
      message: "Bootloader not detected automatically. Select your device from the browser picker...",
    });

    return this.manualBootloaderSelect(method);
  }

  /**
   * PX4 bootloader uses its own serial protocol (GET_SYNC).
   * Reuse existing port or request a new one.
   */
  private async waitForPx4Bootloader(
    existingPort: SerialPort | null,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<FirmwareFlasher> {
    await this.delay(1500);

    for (let attempt = 0; attempt < BOOTLOADER_POLL_MAX_S; attempt++) {
      this.checkAbort(signal);

      onProgress({
        phase: "bootloader_wait",
        percent: 6 + Math.round(((attempt + 1) / BOOTLOADER_POLL_MAX_S) * 3),
        message: `Waiting for PX4 bootloader... (${attempt + 1}s / ${BOOTLOADER_POLL_MAX_S}s)`,
      });

      const port = existingPort ?? await this.findPermittedSerialPort();
      if (port) {
        // PX4 bootloader runs at 115200, no parity. We can't easily probe
        // without the full PX4SerialFlasher, so after enough wait just try it.
        if (attempt >= 2) {
          onProgress({
            phase: "bootloader_init",
            percent: 9,
            message: "Connecting to PX4 bootloader...",
          });
          return new PX4SerialFlasher(port);
        }
      }

      await this.delay(BOOTLOADER_POLL_INTERVAL_MS);
    }

    onProgress({
      phase: "bootloader_init",
      percent: 9,
      message: "PX4 bootloader not detected. Select serial port...",
    });
    const port = await PX4SerialFlasher.requestPort();
    return new PX4SerialFlasher(port);
  }

  /**
   * Probe a serial port for STM32 bootloader presence.
   *
   * Opens the port with bootloader settings (115200, even parity),
   * sends the 0x7F sync byte, and checks for ACK (0x79) or echo (0x7F).
   * Closes the port afterwards so the STM32SerialFlasher can open it fresh.
   *
   * Returns true if bootloader responded, false if timeout or wrong response.
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

      // Send sync byte
      await writer.write(new Uint8Array([SYNC]));

      // Wait up to 500ms for response
      const response = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500)
        ),
      ]);

      if (response.value && response.value.length > 0) {
        const byte = response.value[0];
        if (byte === ACK || byte === SYNC) {
          // Bootloader is alive. Close port so flasher can reopen.
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

      // No valid response — not in bootloader mode yet
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = null;
      await writer.close().catch(() => {});
      writer.releaseLock();
      writer = null;
      await port.close().catch(() => {});
      return false;
    } catch {
      // Port open/read failed — device not ready
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (writer) { await writer.close().catch(() => {}); writer.releaseLock(); }
      await port.close().catch(() => {});
      return false;
    }
  }

  /**
   * Scan all previously-permitted serial ports. Returns the first one found,
   * or null if none are available.
   */
  private async findPermittedSerialPort(): Promise<SerialPort | null> {
    if (typeof navigator === "undefined" || !("serial" in navigator)) return null;
    try {
      const ports = await navigator.serial.getPorts();
      return ports.length > 0 ? ports[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Fall back to browser device picker when automatic detection fails.
   * Tries DFU picker first (for auto/dfu method), then serial picker.
   */
  private async manualBootloaderSelect(
    method: "serial" | "dfu" | "auto",
  ): Promise<FirmwareFlasher> {
    if (method === "dfu") {
      if (!STM32DfuFlasher.isSupported()) {
        throw new Error("WebUSB not supported in this browser. Use Chrome or Edge.");
      }
      const device = await STM32DfuFlasher.requestDevice();
      return new STM32DfuFlasher(device);
    }

    if (method === "auto") {
      // Try DFU picker first, then serial as fallback
      if (STM32DfuFlasher.isSupported()) {
        try {
          const known = await STM32DfuFlasher.getKnownDevices();
          if (known.length > 0) {
            return new STM32DfuFlasher(known[0].device);
          }
          const device = await STM32DfuFlasher.requestDevice();
          return new STM32DfuFlasher(device);
        } catch {
          // User cancelled DFU picker or no DFU device — try serial
        }
      }
    }

    // Serial picker
    const port = await STM32SerialFlasher.requestPort();
    return new STM32SerialFlasher(port);
  }

  private async restoreParameters(
    params: ParameterValue[],
    onProgress: FlashProgressCallback,
  ): Promise<void> {
    // At this point the FC has rebooted with new firmware.
    // We need a fresh MAVLink connection to restore parameters.
    // If the protocol is still connected, use it. Otherwise skip.
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
        const result = await this.protocol.setParameter(param.name, param.value, param.type);
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

  private checkAbort(signal: AbortSignal): void {
    if (signal.aborted) throw new Error("Flash aborted by user");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
