/**
 * MAVLink v2 message signing.
 *
 * A signed frame sets incompat_flags bit 0, carries a CRC computed with that
 * flag set, and appends link_id (1 B), a 48-bit little-endian timestamp and
 * the first 6 bytes of SHA-256(secret_key || frame[STX..CRC] || link_id ||
 * timestamp).
 *
 * @license GPL-3.0-only
 */

import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  MavlinkSigner,
  generateRandomKey,
  keyBytesToHex,
  keyFingerprint,
  zeroize,
} from "@/lib/protocol/mavlink-signer";
import { sha256 } from "@/lib/protocol/sha256";
import { MAVLinkParser, type MAVLinkFrame } from "@/lib/protocol/mavlink-parser";
import { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import { buildFrame, resetSequences } from "@/lib/protocol/encoders/frame";
import type { Transport, TransportEventMap } from "@/lib/protocol/types";

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

/** HEARTBEAT payload (custom_mode 0, GCS, INVALID autopilot, standby, v3). */
function gcsHeartbeatPayload(): Uint8Array {
  return Uint8Array.from([0, 0, 0, 0, 6, 8, 0, 4, 3]);
}

/** A signer whose next timestamp is exactly `ts` (clock held before 2015). */
function signerAt(ts: bigint, linkId = 3): MavlinkSigner {
  const s = new MavlinkSigner("drone-a", linkId, "keyid", KEY);
  s.seedTimestamp(ts - BigInt(1));
  return s;
}

describe("sha256", () => {
  it.each([0, 1, 55, 56, 63, 64, 65, 119, 128, 300])("matches the reference digest for %i bytes", (n) => {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("hashes split input the same as the concatenation", () => {
    const a = Uint8Array.from({ length: 40 }, (_, i) => i);
    const b = Uint8Array.from({ length: 50 }, (_, i) => 255 - i);
    expect(hex(sha256(a, b))).toBe(createHash("sha256").update(a).update(b).digest("hex"));
  });
});

describe("MavlinkSigner.signFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2014-06-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces the reference signed HEARTBEAT byte for byte", () => {
    // Key 00..1f, link 3, timestamp 0x0123456789, seq 7, sender 255/190.
    const unsigned = buildFrame(0, gcsHeartbeatPayload(), 255, 190, 7);
    const signed = signerAt(BigInt(0x0123456789)).signFrame(unsigned);
    expect(hex(signed)).toBe(
      "fd09010007ffbe0000000000000006080004039902038967452301006471fe6ce661",
    );
  });

  it("signature is SHA-256(key || STX..CRC || link_id || ts48), first 6 bytes", () => {
    const unsigned = buildFrame(76, new Uint8Array(33).fill(0x5a), 255, 190, 42);
    const signed = signerAt(BigInt(0x00aabbccddee), 9).signFrame(unsigned);

    const unsignedLen = unsigned.length;
    const expected = createHash("sha256")
      .update(KEY)
      .update(signed.subarray(0, unsignedLen)) // header from STX, payload, CRC
      .update(Uint8Array.from([9, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00])) // link_id, ts48 LE
      .digest()
      .subarray(0, 6);

    expect(signed.length).toBe(unsignedLen + 13);
    expect(Array.from(signed.subarray(unsignedLen, unsignedLen + 7))).toEqual([9, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00]);
    expect(hex(signed.subarray(unsignedLen + 7))).toBe(hex(expected));
  });

  it("sets the signed flag and a CRC the receiver accepts", () => {
    const unsigned = buildFrame(0, gcsHeartbeatPayload(), 255, 190, 7);
    const signer = signerAt(BigInt(1_000_000));
    const signed = signer.signFrame(unsigned);

    expect(signed[2] & 0x01).toBe(1);
    // The unsigned CRC no longer matches once the flag is set.
    expect(hex(signed.subarray(19, 21))).not.toBe(hex(unsigned.subarray(19, 21)));

    const parser = new MAVLinkParser();
    const frames: MAVLinkFrame[] = [];
    let tailOk = false;
    parser.onFrame((f) => frames.push(f));
    parser.onSignedFrame(({ signedRegion, sigTail }) => {
      const whole = new Uint8Array(signedRegion.length + sigTail.length);
      whole.set(signedRegion);
      whole.set(sigTail, signedRegion.length);
      tailOk = signer.verifyFrame(whole);
    });
    parser.feed(signed);

    expect(frames).toHaveLength(1);
    expect(parser.crcFailureCount).toBe(0);
    expect(tailOk).toBe(true);
  });

  it("verifyFrame rejects a flipped payload bit and another key", () => {
    const signed = signerAt(BigInt(5000)).signFrame(buildFrame(0, gcsHeartbeatPayload(), 255, 190, 1));
    const other = new MavlinkSigner("drone-a", 3, "other", new Uint8Array(32).fill(1));
    expect(other.verifyFrame(signed)).toBe(false);
    const tampered = new Uint8Array(signed);
    tampered[14] ^= 0x01;
    expect(signerAt(BigInt(1)).verifyFrame(tampered)).toBe(false);
  });

  it("leaves MAVLink v1 and already-signed frames unchanged", () => {
    const signer = signerAt(BigInt(10));
    const v1 = Uint8Array.from([0xfe, 9, 0, 255, 190, 0, 0, 0, 0, 0, 6, 8, 0, 4, 3, 0, 0]);
    expect(signer.signFrame(v1)).toBe(v1);
    const once = signer.signFrame(buildFrame(0, gcsHeartbeatPayload(), 255, 190, 2));
    expect(signer.signFrame(once)).toBe(once);
  });

  it("timestamps strictly increase and never regress when the clock goes back", () => {
    const signer = new MavlinkSigner("d", 0, "k", KEY);
    vi.setSystemTime(new Date("2026-04-17T12:00:00Z"));
    const f = () => buildFrame(0, gcsHeartbeatPayload(), 255, 190, 0);
    const ts = (s: Uint8Array) => s.subarray(22, 28).reduceRight((v, b) => (v << BigInt(8)) | BigInt(b), BigInt(0));
    const t1 = ts(signer.signFrame(f()));
    const t2 = ts(signer.signFrame(f()));
    vi.setSystemTime(new Date("2026-04-17T11:55:00Z"));
    const t3 = ts(signer.signFrame(f()));
    expect(t2 > t1).toBe(true);
    expect(t3 > t2).toBe(true);
  });

  it("seedTimestamp raises but never lowers the counter", () => {
    const signer = new MavlinkSigner("d", 0, "k", KEY);
    signer.seedTimestamp(BigInt(1_000_000));
    signer.seedTimestamp(BigInt(0));
    expect(signer.currentTimestamp()).toBe(BigInt(1_000_000));
  });

  it("rejects a link id outside one byte and a key that is not 32 bytes", () => {
    expect(() => new MavlinkSigner("d", 256, "k", KEY)).toThrow();
    expect(() => new MavlinkSigner("d", 0, "k", new Uint8Array(16))).toThrow(/32 bytes/);
  });
});

describe("MAVLinkAdapter outbound signing", () => {
  class FakeTransport implements Transport {
    readonly type = "websocket" as const;
    readonly canCommand = true;
    isConnected = true;
    readonly sent: Uint8Array[] = [];
    private handlers = new Set<(d: Uint8Array) => void>();
    async connect(): Promise<void> {}
    async disconnect(): Promise<void> {
      this.isConnected = false;
    }
    send(data: Uint8Array): void {
      this.sent.push(data);
    }
    on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
      if (event === "data") this.handlers.add(handler as unknown as (d: Uint8Array) => void);
    }
    off<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
      if (event === "data") this.handlers.delete(handler as unknown as (d: Uint8Array) => void);
    }
    receive(d: Uint8Array): void {
      for (const h of this.handlers) h(d);
    }
  }

  beforeEach(() => {
    resetSequences();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs every frame on the wire while a signer is set, and stops when cleared", async () => {
    const t = new FakeTransport();
    const adapter = new MAVLinkAdapter();
    const signer = new MavlinkSigner("drone-a", 1, "keyid", KEY);
    adapter.setSigner(signer);

    const connecting = adapter.connect(t);
    t.receive(buildFrame(0, Uint8Array.from([0, 0, 0, 0, 2, 3, 0, 3, 3]), 1, 1));
    await connecting;
    await vi.advanceTimersByTimeAsync(1100);

    expect(t.sent.length).toBeGreaterThan(0);
    for (const frame of t.sent) {
      expect(frame[2] & 0x01).toBe(1);
      expect(signer.verifyFrame(frame)).toBe(true);
    }

    adapter.setSigner(null);
    t.sent.length = 0;
    await vi.advanceTimersByTimeAsync(1100);
    expect(t.sent.length).toBeGreaterThan(0);
    for (const frame of t.sent) expect(frame[2] & 0x01).toBe(0);

    await adapter.disconnect();
  });
});

describe("key helpers", () => {
  it("generateRandomKey returns 32 fresh bytes", () => {
    expect(generateRandomKey()).toHaveLength(32);
    expect(generateRandomKey()).not.toEqual(generateRandomKey());
  });

  it("keyBytesToHex encodes lowercase hex", () => {
    expect(keyBytesToHex(KEY)).toBe("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  });

  it("keyFingerprint is 8 hex chars and changes with the key", async () => {
    const fp = await keyFingerprint(KEY);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(await keyFingerprint(new Uint8Array(32))).not.toBe(fp);
  });

  it("zeroize overwrites the buffer in place", () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    zeroize(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });
});
