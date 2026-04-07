/**
 * @module BluetoothTransport
 * @description Web Bluetooth transport for flight controllers exposing the Nordic UART
 * Service (NUS). Used by Betaflight, iNav, RubyFPV, SpeedyBee, and many other FCs with
 * onboard Bluetooth modules. Browser-only — requires Chromium-based browser with Web
 * Bluetooth API support and a secure context (HTTPS or localhost).
 * @license GPL-3.0-only
 */

import type { Transport } from "../types";

// Web Bluetooth API type declarations (not in standard TypeScript DOM lib)
interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}
interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice;
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
}
interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}
interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}
interface RequestDeviceOptions {
  filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>;
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}
interface BluetoothNavigator {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
}
declare global {
  interface Navigator {
    bluetooth?: BluetoothNavigator;
  }
}

type TransportEventMap = {
  data: Uint8Array;
  close: void;
  error: Error;
};

// Nordic UART Service (NUS) — de facto standard for serial-over-BLE
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
// Notifications from device to client (TX from FC's perspective)
const NUS_TX_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
// Writes from client to device (RX from FC's perspective)
const NUS_RX_CHAR = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// Conservative chunk size — most BLE stacks negotiate ATT MTU 23-247.
// 20 bytes is the safe minimum (23 byte ATT MTU - 3 byte header).
const MAX_CHUNK_BYTES = 20;

export class BluetoothTransport implements Transport {
  readonly type = "ble" as const;

  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private _connected = false;
  private _disconnecting = false;
  private listeners: Map<keyof TransportEventMap, Set<(data: never) => void>> = new Map();
  private notificationHandler: ((event: Event) => void) | null = null;
  private disconnectHandler: ((event: Event) => void) | null = null;
  // Write queue for serializing characteristic writes (BLE doesn't allow concurrent writes)
  private writeQueue: Promise<void> = Promise.resolve();

  get isConnected(): boolean {
    return this._connected;
  }

  /** Get the connected device name (for UI display). */
  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  /** Check if Web Bluetooth API is available in this browser/context. */
  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      "bluetooth" in navigator &&
      typeof window !== "undefined" &&
      window.isSecureContext
    );
  }

  /**
   * Open the browser Bluetooth device picker filtered by Nordic UART Service,
   * then connect to GATT and set up TX notifications.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }

    if (!BluetoothTransport.isSupported()) {
      throw new Error(
        "Web Bluetooth not supported — use Chrome or Edge in a secure context (HTTPS or localhost)",
      );
    }

    try {
      const bt = navigator.bluetooth;
      if (!bt) throw new Error("Web Bluetooth API not available");
      // Request a device exposing the Nordic UART Service
      this.device = await bt.requestDevice({
        filters: [{ services: [NUS_SERVICE] }],
        optionalServices: [NUS_SERVICE],
      });

      // Listen for device disconnection events
      this.disconnectHandler = () => {
        if (this._connected && !this._disconnecting) {
          this._connected = false;
          this.emit("close", undefined as never);
        }
      };
      this.device.addEventListener("gattserverdisconnected", this.disconnectHandler);

      if (!this.device.gatt) {
        throw new Error("Selected device has no GATT support");
      }

      // Connect to GATT server
      this.server = await this.device.gatt.connect();

      // Get the NUS service
      const service = await this.server.getPrimaryService(NUS_SERVICE);

      // Get TX (notifications from device) and RX (writes to device) characteristics
      this.txChar = await service.getCharacteristic(NUS_TX_CHAR);
      this.rxChar = await service.getCharacteristic(NUS_RX_CHAR);

      // Set up notification handler
      this.notificationHandler = (event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const value = target.value;
        if (value && value.byteLength > 0) {
          const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          // Copy the bytes — the underlying buffer can be reused by the browser
          this.emit("data", new Uint8Array(bytes));
        }
      };
      this.txChar.addEventListener("characteristicvaluechanged", this.notificationHandler);

      // Start receiving notifications
      await this.txChar.startNotifications();

      this._connected = true;
    } catch (err) {
      this._connected = false;
      // Clean up partial state
      try {
        if (this.device && this.disconnectHandler) {
          this.device.removeEventListener("gattserverdisconnected", this.disconnectHandler);
        }
        if (this.server?.connected) this.server.disconnect();
      } catch { /* ignore */ }
      this.device = null;
      this.server = null;
      this.txChar = null;
      this.rxChar = null;
      this.notificationHandler = null;
      this.disconnectHandler = null;
      throw err;
    }
  }

  /** Send raw bytes over BLE. Fragments if larger than MAX_CHUNK_BYTES. Fire-and-forget. */
  send(data: Uint8Array): void {
    if (!this._connected || !this.rxChar) {
      throw new Error("Not connected");
    }
    const rxChar = this.rxChar;

    // Queue the write to serialize concurrent send() calls.
    // Copy into a fresh ArrayBuffer to satisfy BufferSource type (avoid SharedArrayBuffer concerns).
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        if (data.byteLength <= MAX_CHUNK_BYTES) {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          await rxChar.writeValueWithoutResponse(copy.buffer);
        } else {
          // Fragment into MTU-sized chunks
          for (let offset = 0; offset < data.byteLength; offset += MAX_CHUNK_BYTES) {
            const end = Math.min(offset + MAX_CHUNK_BYTES, data.byteLength);
            const chunk = new Uint8Array(end - offset);
            chunk.set(data.subarray(offset, end));
            await rxChar.writeValueWithoutResponse(chunk.buffer);
          }
        }
      } catch (err) {
        if (this._connected) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  /** Disconnect from the BLE device. Idempotent. */
  async disconnect(): Promise<void> {
    if (this._disconnecting) return;
    if (!this._connected && !this.device) return;

    this._disconnecting = true;
    this._connected = false;

    try {
      // Stop notifications first
      if (this.txChar && this.notificationHandler) {
        try {
          this.txChar.removeEventListener("characteristicvaluechanged", this.notificationHandler);
          await this.txChar.stopNotifications().catch(() => {});
        } catch { /* ignore */ }
      }

      // Remove disconnect listener and close GATT
      if (this.device) {
        if (this.disconnectHandler) {
          this.device.removeEventListener("gattserverdisconnected", this.disconnectHandler);
        }
        if (this.device.gatt?.connected) {
          this.device.gatt.disconnect();
        }
      }
    } finally {
      this.txChar = null;
      this.rxChar = null;
      this.server = null;
      this.device = null;
      this.notificationHandler = null;
      this.disconnectHandler = null;
      this._disconnecting = false;
      this.emit("close", undefined as never);
    }
  }

  on<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (data: never) => void);
  }

  off<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void,
  ): void {
    this.listeners.get(event)?.delete(handler as (data: never) => void);
  }

  private emit<K extends keyof TransportEventMap>(
    event: K,
    data: TransportEventMap[K],
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
