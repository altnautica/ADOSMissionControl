/**
 * Serial port manager — wraps navigator.serial for port lifecycle.
 * Provides port enumeration, labeling, and hot-plug detection.
 */

/// <reference path="./protocol/web-serial.d.ts" />

import { matchesBootloader, type BootloaderId } from "./serial-bootloader-ids";

export interface PortInfo {
  port: SerialPort;
  label: string;
  vendorId?: number;
  productId?: number;
}

/**
 * The permitted port a saved serial link should reopen: the single port whose
 * USB VID/PID match the saved ones, or the only permitted port when the saved
 * link carries no USB identity. Null when nothing matches or more than one
 * port does, so the caller asks the operator instead of opening whichever
 * port happens to be first (a telemetry radio instead of the flight
 * controller, say).
 */
export function matchKnownPort(
  ports: readonly PortInfo[],
  vendorId: number | undefined,
  productId: number | undefined,
): PortInfo | null {
  const candidates =
    vendorId === undefined || productId === undefined
      ? ports
      : ports.filter((p) => p.vendorId === vendorId && p.productId === productId);
  return candidates.length === 1 ? candidates[0] : null;
}

/** Options for {@link SerialPortManagerImpl.waitForBootloaderPort}. */
export interface WaitForBootloaderOptions {
  /** Ports already permitted BEFORE the reboot, used to detect a fresh device. */
  knownBefore: PortInfo[];
  /** Bootloader VID/PID table to shortlist a re-enumerated device. */
  ids: readonly BootloaderId[];
  /** Give up after this many ms. */
  timeoutMs: number;
  /** Aborts the wait. */
  signal?: AbortSignal;
  /** Called ~every poll with elapsed ms, for progress ticks. */
  onTick?: (elapsedMs: number) => void;
}

const BOOTLOADER_POLL_INTERVAL_MS = 500;

type PortEventHandler = (info: PortInfo) => void;

class SerialPortManagerImpl {
  private connectHandlers = new Set<PortEventHandler>();
  private disconnectHandlers = new Set<PortEventHandler>();
  private initialized = false;

  /** Check if Web Serial API is available. */
  isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  /** Initialize event listeners (call once on app mount). */
  init(): void {
    if (this.initialized || !this.isSupported()) return;
    this.initialized = true;

    navigator.serial.addEventListener("connect", (e: Event) => {
      const port = (e as unknown as { target: SerialPort }).target;
      if (port && "getInfo" in port) {
        const info = this.buildPortInfo(port);
        this.connectHandlers.forEach((h) => h(info));
      }
    });

    navigator.serial.addEventListener("disconnect", (e: Event) => {
      const port = (e as unknown as { target: SerialPort }).target;
      if (port && "getInfo" in port) {
        const info = this.buildPortInfo(port);
        this.disconnectHandlers.forEach((h) => h(info));
      }
    });
  }

  /** Get all previously-permitted serial ports (no user prompt). */
  async getKnownPorts(): Promise<PortInfo[]> {
    if (!this.isSupported()) return [];
    try {
      const ports = await navigator.serial.getPorts();
      return ports.map((port, i) => this.buildPortInfo(port, i));
    } catch {
      return [];
    }
  }

  /** Open browser port picker and return the selected port. */
  async requestNewPort(): Promise<PortInfo> {
    if (!this.isSupported()) {
      throw new Error("Web Serial not supported");
    }
    const port = await navigator.serial.requestPort();
    return this.buildPortInfo(port);
  }

  /** Build a human-readable label for a serial port. */
  getPortLabel(port: SerialPort): string {
    return this.buildPortInfo(port).label;
  }

  /** Subscribe to hot-plug connect events. Returns unsubscribe function. */
  onConnect(handler: PortEventHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  /** Subscribe to hot-plug disconnect events. Returns unsubscribe function. */
  onDisconnect(handler: PortEventHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  /** Snapshot of currently-permitted ports (alias of {@link getKnownPorts}). */
  async snapshotKnownPorts(): Promise<PortInfo[]> {
    return this.getKnownPorts();
  }

  /**
   * Resolve the serial port to talk to a flight controller's bootloader after
   * a reboot-to-bootloader on a NATIVE-USB board, where the device disconnects
   * and re-enumerates as a different USB device (so the old handle is dead).
   *
   * Strategy: race a hot-plug `connect` event for a bootloader-matching device
   * against a `getPorts()` poll that (a) catches a device that enumerated
   * before the listener attached and (b) falls back to "exactly one new port
   * appeared" for boards whose bootloader VID/PID is not in the table.
   *
   * Returns the recovered `SerialPort`, or `null` on timeout/abort. Never opens
   * the port — the caller probes it with the bootloader handshake.
   */
  async waitForBootloaderPort(opts: WaitForBootloaderOptions): Promise<SerialPort | null> {
    if (!this.isSupported()) return null;
    const { knownBefore, ids, timeoutMs, signal, onTick } = opts;
    const knownSet = new Set(knownBefore.map((p) => p.port));
    const started = Date.now();

    return new Promise<SerialPort | null>((resolve) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let unsub: (() => void) | null = null;

      const finish = (port: SerialPort | null) => {
        if (settled) return;
        settled = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (unsub) unsub();
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(port);
      };

      const onAbort = () => finish(null);
      if (signal) {
        if (signal.aborted) {
          finish(null);
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // Fast path: a connect event for a bootloader-matching, not-previously-
      // seen device resolves immediately.
      unsub = this.onConnect((info) => {
        if (settled) return;
        if (!knownSet.has(info.port) && matchesBootloader(info, ids)) {
          finish(info.port);
        }
      });

      // Poll getPorts(): matched-bootloader-first, then single-fresh fallback.
      const poll = async () => {
        if (settled) return;
        onTick?.(Date.now() - started);
        try {
          const ports = await this.getKnownPorts();
          const fresh = ports.filter((p) => !knownSet.has(p.port));
          const matched = fresh.find((p) => matchesBootloader(p, ids));
          if (matched) {
            finish(matched.port);
            return;
          }
          if (fresh.length === 1) {
            finish(fresh[0].port);
            return;
          }
        } catch {
          /* keep polling */
        }
        if (Date.now() - started >= timeoutMs) {
          finish(null);
          return;
        }
        pollTimer = setTimeout(poll, BOOTLOADER_POLL_INTERVAL_MS);
      };
      void poll();
    });
  }

  private buildPortInfo(port: SerialPort, index?: number): PortInfo {
    const info = port.getInfo();
    const vid = info.usbVendorId;
    const pid = info.usbProductId;

    let label: string;
    if (vid !== undefined && pid !== undefined) {
      const vendor = USB_DEVICES[vid];
      const productName = vendor?.products?.[pid];
      if (productName) {
        label = `${productName} (${hex(vid)}:${hex(pid)})`;
      } else if (vendor) {
        label = `${vendor.name} (${hex(vid)}:${hex(pid)})`;
      } else {
        label = `USB Serial (${hex(vid)}:${hex(pid)})`;
      }
    } else {
      label = index !== undefined ? `Serial Port ${index + 1}` : "Serial Port";
    }

    return { port, label, vendorId: vid, productId: pid };
  }
}

function hex(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}

/** USB device database — VID → vendor name + optional PID → product name. */
const USB_DEVICES: Record<number, { name: string; products?: Record<number, string> }> = {
  0x0403: { name: "FTDI", products: {
    0x6001: "FTDI FT232R",
    0x6010: "FTDI FT2232H",
    0x6015: "FTDI FT230X",
  }},
  0x0483: { name: "STMicroelectronics", products: {
    0x5740: "STM32 Flight Controller",
    0x374E: "STLink Virtual COM",
  }},
  0x10C4: { name: "Silicon Labs", products: {
    0xEA60: "Silicon Labs CP2102",
    0xEA70: "Silicon Labs CP2105",
  }},
  0x1A86: { name: "CH340/CH341", products: {
    0x7523: "CH340",
    0x5523: "CH341A",
  }},
  0x2341: { name: "Arduino" },
  0x239A: { name: "Adafruit" },
  0x1209: { name: "Open Source Hardware", products: {
    0x5740: "ArduPilot ChibiOS",
  }},
  0x2DAE: { name: "CubePilot", products: {
    0x1001: "CubeBlack bootloader",
    0x1002: "CubeYellow bootloader",
    0x1005: "CubePurple bootloader",
    0x1011: "CubeBlack",
    0x1012: "CubeYellow",
    0x1015: "CubePurple",
    0x1016: "CubeOrange",
    0x1101: "CubeBlack+",
  }},
  0x27AC: { name: "VRBrain" },
  0x3162: { name: "Holybro", products: {
    0x004B: "Durandal",
  }},
  0x26AC: { name: "3DR / PX4", products: {
    0x0001: "PX4 FMU v2",
    0x0011: "PX4 ChibiOS",
    0x0012: "PixRacer",
    0x0032: "Pixhawk 4",
  }},
  0x1FC9: { name: "NXP" },
  0x067B: { name: "Prolific", products: {
    0x2303: "Prolific PL2303",
  }},
  0x2E8A: { name: "Raspberry Pi" },
  0x29AC: { name: "GD32" },
  0x2E3C: { name: "AT32" },
};

/** Singleton serial port manager. */
export const serialPortManager = new SerialPortManagerImpl();
