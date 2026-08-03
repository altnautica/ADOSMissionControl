/**
 * Web Serial API transport for USB/UART connections.
 * Browser-only — requires Chrome/Edge with Web Serial API support.
 */

/// <reference path="../web-serial.d.ts" />
import type { Transport } from "../types";

type TransportEventMap = {
  data: Uint8Array;
  close: void;
  error: Error;
};

export class WebSerialTransport implements Transport {
  readonly type = "webserial" as const;
  /**
   * A direct link: bytes written here go to the flight controller over this
   * connection, so a command that leaves is a command that arrives.
   */
  readonly canCommand = true;

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private _connected = false;
  private _disconnecting = false;
  private listeners: Map<
    keyof TransportEventMap,
    Set<(data: never) => void>
  > = new Map();

  get isConnected(): boolean {
    return this._connected;
  }

  /** Expose the underlying serial port for bootloader mode. */
  getPort(): SerialPort | null {
    return this.port;
  }

  /** Check if Web Serial API is available in this browser. */
  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  /**
   * Best-effort close of a port that may still be open from a previous
   * Electron/Chrome session (orphan app, crash, connect dialog without disconnect).
   * Web Serial only allows one open handle; failing to close first surfaces as
   * "Failed to open serial port" / port in use.
   */
  private static async ensurePortClosed(port: SerialPort): Promise<void> {
    try {
      // readable/writable present means the port is open in this renderer.
      if (port.readable || port.writable) {
        await port.close().catch(() => {});
      }
    } catch {
      // ignore — open() will throw a clearer error if still locked elsewhere
    }
  }

  private static formatOpenError(err: unknown): Error {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (
      lower.includes("failed to open") ||
      lower.includes("already open") ||
      lower.includes("access denied") ||
      lower.includes("networkerror")
    ) {
      return new Error(
        `${msg} — serial port is usually held by another app (another Electron/Altnautica window, Chrome/Edge tab, Mission Planner, QGC, Betaflight Configurator). ` +
          `Quit those, or in this app disconnect first; then fully quit Electron (not just reload) and retry.`,
      );
    }
    return err instanceof Error ? err : new Error(msg);
  }

  private async openPortStreams(baudRate: number): Promise<void> {
    if (!this.port) throw new Error("No serial port");
    await WebSerialTransport.ensurePortClosed(this.port);
    try {
      await this.port.open({ baudRate });
    } catch (err) {
      throw WebSerialTransport.formatOpenError(err);
    }
    this._connected = true;
    if (this.port.readable) {
      this.reader = this.port.readable.getReader();
    }
    if (this.port.writable) {
      this.writer = this.port.writable.getWriter();
    }
    this.readLoop();
  }

  /**
   * Open the browser serial port picker and connect.
   * @param baudRate — UART baud rate, default 115200 (standard for MAVLink)
   */
  async connect(baudRate: number = 115200): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }

    if (!WebSerialTransport.isSupported()) {
      throw new Error(
        "Web Serial API not supported — use Chrome or Edge"
      );
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.openPortStreams(baudRate);
    } catch (err) {
      this._connected = false;
      this.port = null;
      throw err instanceof Error ? err : WebSerialTransport.formatOpenError(err);
    }
  }

  /**
   * Connect using an already-permitted SerialPort (no browser picker).
   * Use this with ports from `navigator.serial.getPorts()`.
   */
  async connectToPort(port: SerialPort, baudRate: number = 115200): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }

    try {
      this.port = port;
      await this.openPortStreams(baudRate);
    } catch (err) {
      this._connected = false;
      this.port = null;
      throw err instanceof Error ? err : WebSerialTransport.formatOpenError(err);
    }
  }

  /** Continuous read loop — runs until disconnect or device removal. */
  private async readLoop(): Promise<void> {
    if (!this.reader) return;

    try {
      while (this._connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.emit("data", value);
        }
      }
    } catch (err) {
      // Device disconnected or read error
      if (this._connected) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (this._connected && !this._disconnecting) {
        this._connected = false;
        this.emit("close", undefined as never);
      }
    }
  }

  /** Send raw bytes over serial. Fire-and-forget. */
  send(data: Uint8Array): void {
    if (!this._connected || !this.writer) {
      throw new Error("Not connected");
    }
    // Fire and forget — don't await
    this.writer.write(data).catch((err) => {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }

  /** Disconnect and release the serial port. Idempotent — safe to call multiple times. */
  async disconnect(): Promise<void> {
    if (this._disconnecting) return;
    if (!this._connected && !this.port) return;

    this._disconnecting = true;
    this._connected = false;

    try {
      if (this.reader) {
        await this.reader.cancel().catch(() => {});
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close().catch(() => {});
        this.writer.releaseLock();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close().catch(() => {});
        this.port = null;
      }
    } finally {
      this._disconnecting = false;
      this.emit("close", undefined as never);
    }
  }

  on<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (data: never) => void);
  }

  off<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void
  ): void {
    this.listeners.get(event)?.delete(handler as (data: never) => void);
  }

  private emit<K extends keyof TransportEventMap>(
    event: K,
    data: TransportEventMap[K]
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (data: TransportEventMap[K]) => void)(data);
      } catch {
        // Don't let listener errors crash the transport
      }
    }
  }
}
