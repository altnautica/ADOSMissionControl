/**
 * Firmware flash orchestration layer.
 *
 * Coordinates the full flash workflow: preflight refusals -> parameter
 * backup -> reboot to bootloader -> detect bootloader -> erase -> flash ->
 * verify -> reboot. Bridges the protocol layer with the low-level PX4-protocol
 * bootloader, STM32 USB DFU and STM32 ROM (UART) flashers.
 *
 * Which flasher runs follows from the image:
 *   - an application image (.apj / .px4, `bootloaderApp`) goes only through
 *     the PX4-protocol bootloader, which the PX4 and ArduPilot USB
 *     bootloaders both speak, and which writes it at its own app offset;
 *   - an absolute image (.hex, `_with_bl.hex`) goes through USB DFU or the ST
 *     ROM bootloader (UART, BOOT0).
 *
 * Flashing is refused unless the flight controller is attached to this
 * browser over a local USB serial link: a reboot-to-bootloader sent over a
 * network link would strand the remote FC in a bootloader nobody can reach.
 *
 * Native-USB flight controllers re-enumerate as a different USB device when
 * they drop into their bootloader. A USB-UART-bridge board keeps the same
 * port handle. The bootloader-acquisition step handles both: it probes the
 * existing handle first (bridge fast path), then waits for a
 * freshly-enumerated bootloader device (native USB), then falls back to a
 * user-gesture device picker.
 *
 * @module protocol/firmware/flash-manager
 */

import type {
  DroneProtocol,
  Transport,
} from "../types";
import type {
  FlashOptions,
  FlashProgressCallback,
  FlashLogCallback,
  FlashUserAction,
  ParsedFirmware,
  FirmwareFlasher,
} from "./types";
import { WITH_BL_REQUIRED_MESSAGE } from "./types";
import { STM32SerialFlasher } from "./stm32-serial";
import { STM32DfuFlasher } from "./stm32-dfu";
import { PX4SerialFlasher } from "./px4-serial";
import { bootloaderAppImage } from "./px4-serial-helpers";
import { saveFlashParamBackup, type FlashParamBackup } from "./param-backup";
import { serialPortManager } from "@/lib/serial-port-manager";
import {
  ALL_FC_BOOTLOADER_IDS,
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
// Reboot:          95-100%

/** Max ms to wait for a re-enumerated bootloader device after reboot. */
const BOOTLOADER_POLL_MAX_MS = 20000;
/** Ms between DFU known-device polls. */
const DFU_POLL_INTERVAL_MS = 700;

/** Refusal when the selected flight controller is not on a local USB serial link. */
export const USB_REQUIRED_MESSAGE = "Flashing needs a USB cable to the flight controller.";

/** The flasher a run resolves to once the image kind is known. */
type ResolvedMethod = "px4-serial" | "dfu" | "st-rom-serial" | "absolute-auto";

/** What a completed flash leaves for the operator. */
export interface FlashOutcome {
  /** Parameters saved before the reboot, offered for a reviewed restore. */
  paramBackup: FlashParamBackup | null;
}

/**
 * Why a flash with this link, image and method must not start, or null.
 * Checked before anything touches the flight controller.
 */
export function flashRefusal(
  protocol: Pick<DroneProtocol, "isConnected"> | null,
  transport: Pick<Transport, "type"> | null,
  firmware: ParsedFirmware,
  method: FlashOptions["method"],
): string | null {
  if (protocol?.isConnected && transport?.type !== "webserial") return USB_REQUIRED_MESSAGE;
  if ((method === "dfu" || method === "st-rom-serial") && firmware.bootloaderApp) return WITH_BL_REQUIRED_MESSAGE;
  if (method === "px4-serial") {
    try {
      bootloaderAppImage(firmware);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  return null;
}

// ── FlashManager ───────────────────────────────────────

export class FlashManager {
  private protocol: DroneProtocol | null;
  private transport: Transport | null;
  private abortController: AbortController | null = null;
  private flasher: FirmwareFlasher | null = null;
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
  ): Promise<FlashOutcome> {
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
    let paramBackup: FlashParamBackup | null = null;

    try {
      // ── Step 0: Refuse before touching the FC ────────
      const refusal = flashRefusal(this.protocol, this.transport, firmware, options.method);
      if (refusal) throw new Error(refusal);
      this.checkBoardMatches(firmware, options);
      const method: ResolvedMethod = options.method === "auto"
        ? (firmware.bootloaderApp ? "px4-serial" : "absolute-auto")
        : options.method;

      // ── Step 1: Back up parameters (persisted before the reboot) ──
      if (options.backupParams && this.protocol?.isConnected) {
        onProgress({ phase: "backup", percent: 1, message: "Backing up parameters..." });
        let params;
        try {
          params = await this.protocol.getAllParameters();
        } catch (err) {
          throw new Error(`Parameter backup failed (${err instanceof Error ? err.message : String(err)}). Not flashing.`);
        }
        paramBackup = await saveFlashParamBackup(options.backupBoard ?? String(firmware.boardId ?? "unknown"), params);
        onProgress({
          phase: "backup",
          percent: 5,
          message: `Saved ${paramBackup.params.length} parameters to browser storage and a .param download`,
        });
        this.log("info", `backed up ${paramBackup.params.length} parameters as ${paramBackup.key}`);
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

      this.flasher = await this.waitForBootloader(method, existingPort, onProgress, signal);

      this.checkAbort(signal);

      // ── Step 4: Flash firmware ───────────────────────
      // The flasher erases, writes, verifies (while still in the bootloader),
      // then leaves the bootloader / reboots into the new firmware as its
      // final step. Verification cannot happen after that reboot — the
      // bootloader is gone and the device disconnects — so it lives inside
      // flash(), gated by the verify option, not in a separate pass here.
      await this.flasher.flash(firmware, onProgress, signal, this.onLog ?? undefined, { verify: options.verify });

      this.checkAbort(signal);

      onProgress({
        phase: "done",
        percent: 100,
        message: paramBackup
          ? `Firmware update complete. ${paramBackup.params.length} parameters were saved before flashing; reconnect to review and restore them.`
          : "Firmware update complete!",
      });
      this.log("info", "firmware update complete");
      return { paramBackup };
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

  /**
   * Refuse an image built for a different board than the connected FC
   * reports: AUTOPILOT_VERSION board id against the image's board id, and
   * the MSP board name against the selected target.
   */
  private checkBoardMatches(firmware: ParsedFirmware, options: FlashOptions): void {
    if (!this.protocol?.isConnected || this.allowBoardIdMismatch) return;
    const info = this.protocol.getVehicleInfo();
    if (!info) return;
    if (info.boardId !== undefined && firmware.boardId !== undefined && info.boardId !== firmware.boardId) {
      throw new Error(
        `Board ID mismatch: the firmware is for board id ${firmware.boardId}, but the connected flight controller reports ${info.boardId}. Pick the firmware that matches your board.`,
      );
    }
    const target = options.expectedBoardTarget;
    if (target && info.boardTargetName && info.boardTargetName.toLowerCase() !== target.toLowerCase()) {
      throw new Error(
        `The connected flight controller reports board ${info.boardTargetName}, but the selected target is ${target}. Pick the matching target, or flash the file as a custom file if you are sure.`,
      );
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
    method: ResolvedMethod,
    existingPort: SerialPort | null,
    onProgress: FlashProgressCallback,
    signal: AbortSignal,
  ): Promise<FirmwareFlasher> {
    if (method === "px4-serial") {
      return this.waitForPx4Bootloader(existingPort, onProgress, signal);
    }

    // Give the FC a moment to begin rebooting before we probe / poll.
    await this.delay(1500);

    // ── DFU (native-USB boards): already-permitted devices need no gesture ──
    if (method !== "st-rom-serial" && STM32DfuFlasher.isSupported()) {
      const dfu = await this.pollForDfu(onProgress, signal);
      if (dfu) {
        onProgress({ phase: "bootloader_init", percent: 9, message: `DFU bootloader detected: ${dfu.label}` });
        this.log("info", `DFU bootloader detected: ${dfu.label}`);
        return new STM32DfuFlasher(dfu.device);
      }
    }

    // ── ST ROM bootloader on a USB-UART bridge keeps the same port ──
    if (method !== "dfu" && existingPort && await this.probeStRomSync(existingPort)) {
      onProgress({ phase: "bootloader_init", percent: 9, message: "ST ROM bootloader detected" });
      this.log("info", "ST ROM bootloader detected on existing port (bridge board)");
      return new STM32SerialFlasher(existingPort);
    }

    // ── Fallback: ask the user to pick the device (a real click) ──
    if (method === "st-rom-serial") {
      const port = await this.waitForManualSerialSelect({ kind: "select-bootloader" }, onProgress, signal);
      return new STM32SerialFlasher(port);
    }
    const device = await this.waitForManualUsbSelect({ kind: "select-dfu" }, onProgress, signal);
    return new STM32DfuFlasher(device);
  }

  /**
   * PX4-protocol bootloader path (PX4 and ArduPilot USB bootloaders). Bridge
   * fast path (probe the existing handle) -> native re-enumeration recovery ->
   * user-gesture picker fallback.
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
      onProgress({ phase: "bootloader_wait", percent: 7, message: "Detecting bootloader..." });
      const probe = new PX4SerialFlasher(existingPort, { allowBoardIdMismatch: this.allowBoardIdMismatch });
      if (await probe.trySync(2500, this.onLog ?? undefined)) {
        onProgress({ phase: "bootloader_init", percent: 9, message: "Bootloader detected" });
        this.log("info", "bootloader detected on existing port (bridge board)");
        return probe;
      }
      await probe.dispose();
    }

    // Native USB: the device re-enumerated as a new bootloader device.
    this.log("info", "existing port did not respond — waiting for re-enumerated bootloader");
    const recovered = await serialPortManager.waitForBootloaderPort({
      knownBefore,
      ids: ALL_FC_BOOTLOADER_IDS,
      timeoutMs: BOOTLOADER_POLL_MAX_MS,
      signal,
      onTick: (ms) => onProgress({
        phase: "bootloader_wait",
        percent: 6 + Math.min(3, Math.round((ms / BOOTLOADER_POLL_MAX_MS) * 3)),
        message: `Waiting for bootloader... (${Math.round(ms / 1000)}s)`,
      }),
    });
    if (recovered) {
      const f = new PX4SerialFlasher(recovered, { allowBoardIdMismatch: this.allowBoardIdMismatch });
      if (await f.trySync(3000, this.onLog ?? undefined)) {
        onProgress({ phase: "bootloader_init", percent: 9, message: "Bootloader detected" });
        this.log("info", "bootloader detected on re-enumerated port");
        return f;
      }
      await f.dispose();
    }

    // Fallback: the bootloader is present but was never permission-granted.
    const port = await this.waitForManualSerialSelect(
      { kind: "select-bootloader", filters: [...ALL_FC_BOOTLOADER_IDS] },
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
    const { promise, resolve, reject } = Promise.withResolvers<SerialPort>();
    const onAbort = () => { this.pendingSerialResolver = null; reject(new Error("Flash aborted by user")); };
    if (signal.aborted) { onAbort(); return promise; }
    signal.addEventListener("abort", onAbort, { once: true });
    this.pendingSerialResolver = (port) => {
      signal.removeEventListener("abort", onAbort);
      this.pendingSerialResolver = null;
      resolve(port);
    };
    return promise;
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
    const { promise, resolve, reject } = Promise.withResolvers<USBDevice>();
    const onAbort = () => { this.pendingUsbResolver = null; reject(new Error("Flash aborted by user")); };
    if (signal.aborted) { onAbort(); return promise; }
    signal.addEventListener("abort", onAbort, { once: true });
    this.pendingUsbResolver = (device) => {
      signal.removeEventListener("abort", onAbort);
      this.pendingUsbResolver = null;
      resolve(device);
    };
    return promise;
  }

  /**
   * Probe a serial port for the STM32 ROM bootloader (AN3155).
   *
   * Opens with bootloader settings (115200, even parity), sends the 0x7F sync
   * byte, and checks for ACK (0x79) or echo (0x7F). Closes afterwards so the
   * STM32SerialFlasher can open it fresh.
   */
  private async probeStRomSync(port: SerialPort): Promise<boolean> {
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
        this.delay(500).then(() => ({ value: undefined, done: true as const })),
      ]);

      const byte = response.value && response.value.length > 0 ? response.value[0] : null;
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = null;
      await writer.close().catch(() => {});
      writer.releaseLock();
      writer = null;
      await port.close().catch(() => {});
      return byte === ACK || byte === SYNC;
    } catch {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (writer) { await writer.close().catch(() => {}); writer.releaseLock(); }
      await port.close().catch(() => {});
      return false;
    }
  }

  // ── Helpers ────────────────────────────────────────────

  private log(level: "debug" | "info" | "warning" | "error", message: string): void {
    this.onLog?.(level, message);
  }

  private checkAbort(signal: AbortSignal): void {
    if (signal.aborted) throw new Error("Flash aborted by user");
  }

  private delay(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }
}
