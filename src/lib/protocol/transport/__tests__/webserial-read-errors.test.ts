/**
 * @license GPL-3.0-only
 *
 * A Web Serial read error such as a buffer overrun errors only the current
 * stream; the port then hands out a fresh `readable`. The transport must keep
 * the link and carry on reading instead of reporting a disconnect, and must
 * ask for a receive buffer larger than the browser's 255-byte default.
 */

import { describe, it, expect } from "vitest";
import { WebSerialTransport } from "../webserial";

/** A port whose first stream errors with an overrun and whose second carries data. */
function flakyPort() {
  const streams = [
    new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new DOMException("Buffer overrun", "BufferOverrunError"));
      },
    }),
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Uint8Array.from([0xfd, 1, 2]));
      },
    }),
  ];
  let current = 0;
  const opened: Array<{ baudRate: number; bufferSize?: number }> = [];
  const port = {
    get readable() {
      const s = streams[current];
      // A stream that has errored is replaced by the next one on access.
      return s ?? null;
    },
    writable: new WritableStream<Uint8Array>(),
    open: async (opts: { baudRate: number; bufferSize?: number }) => { opened.push(opts); },
    close: async () => {},
    getInfo: () => ({}),
  };
  return { port: port as unknown as SerialPort, opened, advance: () => { current++; } };
}

describe("WebSerialTransport read errors", () => {
  it("keeps the link through a buffer overrun and reads on", async () => {
    const { port, opened, advance } = flakyPort();
    const t = new WebSerialTransport();
    const firstData = Promise.withResolvers<number[]>();
    let closed = false;
    t.on("data", (d) => firstData.resolve(Array.from(d)));
    t.on("error", () => advance());
    t.on("close", () => { closed = true; });

    await t.connectToPort(port, 115200);

    expect(await firstData.promise).toEqual([0xfd, 1, 2]);
    expect(closed).toBe(false);
    expect(t.isConnected).toBe(true);
    expect(opened[0].bufferSize).toBeGreaterThan(255);
    await t.disconnect();
  });
});
