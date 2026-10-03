/**
 * @module agent/relayed-sysid-filter
 * @description A transport wrapper that confines a relayed MAVLink session to
 * ONE aircraft.
 *
 * A ground station republishes every drone in its fleet on the same MAVLink
 * WebSocket. A session registered under drone B must therefore never see
 * drone A's frames: the adapter locks its target system on the first
 * HEARTBEAT it hears, so an unfiltered stream attaches B's card, cockpit and
 * command lane to whichever aircraft heartbeats first. This wrapper reframes
 * the inbound byte stream and forwards only frames whose source system id is
 * the drone's own (as the ground station's fleet slot table reports it). The
 * adapter consequently learns that system id from the connect HEARTBEAT, and
 * every command it sends targets it.
 *
 * Outbound bytes are passed through unchanged; the ground station's own
 * collision guard and the drone's target filter hold the far side.
 * @license GPL-3.0-only
 */

import type { Transport, TransportEventMap } from "@/lib/protocol/types/transport";

const STX_V1 = 0xfe;
const STX_V2 = 0xfd;
/** MAVLink v2 incompat flag: the frame carries a 13-byte signature. */
const INCOMPAT_SIGNED = 0x01;
/** A partial frame never needs more than one maximum v2 signed frame. */
const MAX_PENDING_BYTES = 280 * 4;

type Handler<K extends keyof TransportEventMap> = (data: TransportEventMap[K]) => void;

/**
 * Split `buf` into complete MAVLink frames. Returns the frames whose source
 * system id equals `systemId`, and the unconsumed tail (a partial frame).
 * Bytes before a start marker are discarded.
 */
export function filterMavlinkFrames(
  buf: Uint8Array,
  systemId: number,
): { passed: Uint8Array[]; rest: Uint8Array } {
  const passed: Uint8Array[] = [];
  let i = 0;
  while (i < buf.length) {
    const stx = buf[i];
    if (stx !== STX_V1 && stx !== STX_V2) {
      i += 1;
      continue;
    }
    if (i + 2 > buf.length) break;
    const payloadLen = buf[i + 1];
    let total: number;
    let sysidOffset: number;
    if (stx === STX_V1) {
      total = 8 + payloadLen;
      sysidOffset = 3;
    } else {
      if (i + 3 > buf.length) break;
      total = 12 + payloadLen + ((buf[i + 2] & INCOMPAT_SIGNED) !== 0 ? 13 : 0);
      sysidOffset = 5;
    }
    if (i + total > buf.length) break;
    if (buf[i + sysidOffset] === systemId) passed.push(buf.subarray(i, i + total));
    i += total;
  }
  return { passed, rest: buf.subarray(i) };
}

export class SystemIdFilterTransport implements Transport {
  readonly type: Transport["type"];
  private readonly inner: Transport;
  private readonly systemId: number;
  private pending: Uint8Array = new Uint8Array(0);
  private readonly dataHandlers = new Set<Handler<"data">>();

  constructor(inner: Transport, systemId: number) {
    this.inner = inner;
    this.type = inner.type;
    this.systemId = systemId;
    inner.on("data", this.onInnerData);
  }

  private readonly onInnerData = (chunk: Uint8Array): void => {
    let buf: Uint8Array;
    if (this.pending.length === 0) {
      buf = chunk;
    } else {
      buf = new Uint8Array(this.pending.length + chunk.length);
      buf.set(this.pending, 0);
      buf.set(chunk, this.pending.length);
    }
    const { passed, rest } = filterMavlinkFrames(buf, this.systemId);
    // A tail longer than any frame is garbage that never framed; drop it so a
    // corrupt stream cannot grow the buffer without bound.
    this.pending = rest.length > MAX_PENDING_BYTES ? new Uint8Array(0) : rest.slice();
    if (passed.length === 0) return;
    let out: Uint8Array;
    if (passed.length === 1) {
      out = passed[0].slice();
    } else {
      out = new Uint8Array(passed.reduce((n, f) => n + f.length, 0));
      let off = 0;
      for (const f of passed) {
        out.set(f, off);
        off += f.length;
      }
    }
    for (const h of this.dataHandlers) h(out);
  };

  get isConnected(): boolean {
    return this.inner.isConnected;
  }

  get canCommand(): boolean {
    return this.inner.canCommand;
  }

  connect(...args: unknown[]): Promise<void> {
    return this.inner.connect(...args);
  }

  disconnect(): Promise<void> {
    this.inner.off("data", this.onInnerData);
    this.dataHandlers.clear();
    this.pending = new Uint8Array(0);
    return this.inner.disconnect();
  }

  send(data: Uint8Array): void {
    this.inner.send(data);
  }

  on<K extends keyof TransportEventMap>(event: K, handler: Handler<K>): void {
    if (event === "data") this.dataHandlers.add(handler as Handler<"data">);
    else this.inner.on(event, handler);
  }

  off<K extends keyof TransportEventMap>(event: K, handler: Handler<K>): void {
    if (event === "data") this.dataHandlers.delete(handler as Handler<"data">);
    else this.inner.off(event, handler);
  }
}
