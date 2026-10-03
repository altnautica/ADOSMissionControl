/**
 * @license GPL-3.0-only
 *
 * A relayed session dialled against a ground station that republishes several
 * drones must hear only its own aircraft: frames from any other system id are
 * dropped before the adapter can lock onto them, including frames split across
 * socket messages.
 */

import { describe, it, expect, vi } from "vitest";

import type { Transport, TransportEventMap } from "@/lib/protocol/types/transport";
import { SystemIdFilterTransport, filterMavlinkFrames } from "../relayed-sysid-filter";

/** A MAVLink v2 frame with `len` payload bytes from `sysid` (CRC bytes zero). */
function v2Frame(sysid: number, msgid: number, len: number, signed = false): Uint8Array {
  const f = new Uint8Array(12 + len + (signed ? 13 : 0));
  f[0] = 0xfd;
  f[1] = len;
  f[2] = signed ? 0x01 : 0x00;
  f[5] = sysid;
  f[6] = 1;
  f[7] = msgid & 0xff;
  return f;
}

/** A MAVLink v1 frame with `len` payload bytes from `sysid`. */
function v1Frame(sysid: number, len: number): Uint8Array {
  const f = new Uint8Array(8 + len);
  f[0] = 0xfe;
  f[1] = len;
  f[3] = sysid;
  return f;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

class FakeTransport implements Transport {
  readonly type = "websocket" as const;
  isConnected = true;
  canCommand = true;
  private handlers: ((d: Uint8Array) => void)[] = [];
  connect = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  send = vi.fn();
  on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void) {
    if (event === "data") this.handlers.push(handler as (d: Uint8Array) => void);
  }
  off() {}
  emit(chunk: Uint8Array) {
    for (const h of this.handlers) h(chunk);
  }
}

describe("filterMavlinkFrames", () => {
  it("keeps only the frames from the wanted system id", () => {
    const own = v2Frame(1, 0, 9);
    const other = v2Frame(2, 0, 9);
    const ownV1 = v1Frame(1, 9);
    const signedOther = v2Frame(2, 30, 28, true);
    const { passed, rest } = filterMavlinkFrames(concat(other, own, signedOther, ownV1), 1);
    expect(passed).toEqual([own, ownV1]);
    expect(rest.length).toBe(0);
  });

  it("returns a trailing partial frame as the remainder", () => {
    const own = v2Frame(1, 0, 9);
    const { passed, rest } = filterMavlinkFrames(concat(own, own.subarray(0, 7)), 1);
    expect(passed).toEqual([own]);
    expect(rest).toEqual(own.subarray(0, 7));
  });
});

describe("SystemIdFilterTransport", () => {
  it("delivers only its aircraft's frames, reassembled across chunks", () => {
    const inner = new FakeTransport();
    const filtered = new SystemIdFilterTransport(inner, 7);
    const received: Uint8Array[] = [];
    filtered.on("data", (d) => received.push(d));

    const own = v2Frame(7, 0, 9);
    const other = v2Frame(3, 0, 9);
    const stream = concat(other, own);
    inner.emit(stream.subarray(0, 15));
    inner.emit(stream.subarray(15));

    expect(received).toEqual([own]);
  });

  it("passes outbound bytes through unchanged", () => {
    const inner = new FakeTransport();
    const filtered = new SystemIdFilterTransport(inner, 7);
    const cmd = v2Frame(255, 76, 33);
    filtered.send(cmd);
    expect(inner.send).toHaveBeenCalledWith(cmd);
  });
});
