/**
 * Web Serial API type declarations.
 * These types are not included in standard TypeScript lib definitions.
 */

interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    parity?: "none" | "even" | "odd";
    stopBits?: 1 | 2;
    dataBits?: 7 | 8;
    /** Receive/transmit buffer size in bytes; the browser default is 255. */
    bufferSize?: number;
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialPortRequestOptions {
  filters?: { usbVendorId?: number; usbProductId?: number }[];
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (ev: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (ev: Event) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface Navigator {
  readonly serial: Serial;
}
