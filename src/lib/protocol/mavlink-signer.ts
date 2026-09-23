/**
 * MAVLink v2 message signing.
 *
 * A signed frame sets MAVLINK_IFLAG_SIGNED (0x01) in incompat_flags, carries
 * a CRC computed with that flag set, and gains a 13-byte tail after the CRC:
 *     [link_id: 1B] [timestamp: 6B LE] [signature: 6B]
 *
 * The signature is the first 6 bytes of
 *     SHA-256(secret_key || frame[STX .. end of CRC] || link_id || timestamp)
 * a plain hash over the 32-byte key and the frame, not an HMAC.
 *
 * Timestamp is unsigned 48-bit little-endian, counts 10-microsecond units
 * since 2015-01-01 00:00:00 UTC. It MUST strictly increase per (sender,
 * link_id) pair. The signer tracks the last emitted timestamp in memory
 * and clamps forward-only: a system clock that jumps backward (or two
 * frames signed within the same 10 us) never causes a regression.
 *
 * The hash needs the raw key bytes, so the signer holds them in memory and
 * the keystore persists them in this browser's IndexedDB. Script running
 * on the page can read them.
 *
 * @module protocol/mavlink-signer
 */

import { CRC_EXTRA, crc16, crc16Accumulate } from "./mavlink-parser";
import { Sha256 } from "./sha256";

const EPOCH_2015_MS = Date.UTC(2015, 0, 1);
const SIGNATURE_TAIL_LEN = 13;
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_100 = BigInt(100);
const BIG_FF = BigInt(0xff);
const BIG_MASK_48 = (BigInt(1) << BigInt(48)) - BigInt(1);

/**
 * Cross-tab coordination channel. Tabs that are currently signing for a
 * drone broadcast their liveness so other tabs showing the same drone can
 * render a "signing active in another tab" hint. Purely observational.
 */
const BROADCAST_CHANNEL_NAME = "ados-signing";
let _broadcastChannel: BroadcastChannel | null = null;
function broadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (_broadcastChannel === null) {
    _broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
  return _broadcastChannel;
}

export interface SigningBroadcastMessage {
  type: "signing-active";
  droneId: string;
  linkId: number;
  tabId: string;
  at: number;
}

/**
 * Stable per-tab id for BroadcastChannel. Random UUID generated once per
 * page load. Does not persist across tabs or reloads by design; each tab
 * wants a unique identity.
 */
let _tabId: string | null = null;
function tabId(): string {
  if (_tabId === null) {
    _tabId = crypto.randomUUID();
  }
  return _tabId;
}

/** MAVLink v2 start-of-frame marker. */
const STX_V2 = 0xfd;
/** incompat_flags bit that marks a signed frame. */
const MAVLINK_IFLAG_SIGNED = 0x01;
const HEADER_LEN = 10;
const CRC_LEN = 2;

/**
 * One signer instance per (droneId, linkId). The outgoing-timestamp counter
 * is per-instance.
 */
export class MavlinkSigner {
  readonly droneId: string;
  readonly linkId: number;
  readonly keyId: string;
  readonly #key: Uint8Array;
  private lastTimestamp: bigint = BIG_ZERO;

  /** `keyBytes` is copied; the caller keeps ownership of its buffer. */
  constructor(droneId: string, linkId: number, keyId: string, keyBytes: Uint8Array) {
    if (linkId < 0 || linkId > 255) {
      throw new Error(`linkId must fit in one byte (0..255), got ${linkId}`);
    }
    if (keyBytes.length !== 32) {
      throw new Error(`signing key must be 32 bytes, got ${keyBytes.length}`);
    }
    this.droneId = droneId;
    this.linkId = linkId;
    this.keyId = keyId;
    this.#key = new Uint8Array(keyBytes);
  }

  /**
   * Seed the monotonic counter from persisted state. Never lets the counter
   * go backward.
   */
  seedTimestamp(persisted: bigint): void {
    if (persisted > this.lastTimestamp) {
      this.lastTimestamp = persisted;
    }
  }

  /** Read the current monotonic counter for persistence. Does not advance. */
  currentTimestamp(): bigint {
    return this.lastTimestamp;
  }

  /**
   * Sign one complete, unsigned MAVLink v2 frame (STX through CRC). Returns
   * a new buffer: the signed flag set, the CRC recomputed over the flagged
   * header, and the 13-byte signature tail appended.
   *
   * MAVLink v1 frames cannot carry a signature and frames that are already
   * signed are left alone; both are returned unchanged.
   */
  signFrame(frame: Uint8Array): Uint8Array {
    if (frame.length < HEADER_LEN + CRC_LEN || frame[0] !== STX_V2) return frame;
    if ((frame[2] & MAVLINK_IFLAG_SIGNED) !== 0) return frame;
    const payloadLen = frame[1];
    const unsignedLen = HEADER_LEN + payloadLen + CRC_LEN;
    if (frame.length !== unsignedLen) {
      throw new Error(`signFrame: expected one ${unsignedLen}-byte frame, got ${frame.length} bytes`);
    }
    const msgId = frame[7] | (frame[8] << 8) | (frame[9] << 16);
    const extra = CRC_EXTRA.get(msgId);
    if (extra === undefined) {
      throw new Error(`signFrame: no CRC_EXTRA seed for message id ${msgId}`);
    }

    const out = new Uint8Array(unsignedLen + SIGNATURE_TAIL_LEN);
    out.set(frame);
    // The flag is inside the CRC and the hash, so it goes in first.
    out[2] |= MAVLINK_IFLAG_SIGNED;
    const crc = crc16Accumulate(extra, crc16(out, 1, HEADER_LEN - 1 + payloadLen));
    out[HEADER_LEN + payloadLen] = crc & 0xff;
    out[HEADER_LEN + payloadLen + 1] = (crc >> 8) & 0xff;

    out[unsignedLen] = this.linkId;
    writeUint48LE(out, unsignedLen + 1, this.nextTimestamp());
    const sig = this.signature(out.subarray(0, unsignedLen + 7));
    out.set(sig, unsignedLen + 7);

    this.announceActive();
    return out;
  }

  /**
   * Check the signature of a signed v2 frame (STX through the 13-byte tail)
   * against this key. Timestamp freshness is the caller's policy.
   */
  verifyFrame(frame: Uint8Array): boolean {
    if (frame.length < HEADER_LEN + CRC_LEN || frame[0] !== STX_V2) return false;
    if ((frame[2] & MAVLINK_IFLAG_SIGNED) === 0) return false;
    const unsignedLen = HEADER_LEN + frame[1] + CRC_LEN;
    if (frame.length !== unsignedLen + SIGNATURE_TAIL_LEN) return false;
    const expected = this.signature(frame.subarray(0, unsignedLen + 7));
    return constantTimeEquals(expected, frame.subarray(unsignedLen + 7, unsignedLen + SIGNATURE_TAIL_LEN));
  }

  /** First 6 bytes of SHA-256(key || signedBytes), signedBytes = frame..link_id..timestamp. */
  private signature(signedBytes: Uint8Array): Uint8Array {
    return new Sha256().update(this.#key).update(signedBytes).digest().subarray(0, 6);
  }

  private _lastAnnouncedAt = 0;
  private announceActive(): void {
    const now = Date.now();
    // Throttle to once per second per signer instance. BroadcastChannel is
    // cheap but the sign path runs at frame rate.
    if (now - this._lastAnnouncedAt < 1000) return;
    this._lastAnnouncedAt = now;
    const ch = broadcastChannel();
    if (!ch) return;
    const msg: SigningBroadcastMessage = {
      type: "signing-active",
      droneId: this.droneId,
      linkId: this.linkId,
      tabId: tabId(),
      at: now,
    };
    try {
      ch.postMessage(msg);
    } catch {
      // non-fatal
    }
  }

  /**
   * Forward-only timestamp: max(now in 10 us units, last + 1). A clock that
   * jumps forward then back therefore never regresses it.
   */
  private nextTimestamp(): bigint {
    const now10us = BigInt(Math.max(0, Date.now() - EPOCH_2015_MS)) * BIG_100;
    const next = now10us > this.lastTimestamp ? now10us : this.lastTimestamp + BIG_ONE;
    this.lastTimestamp = next;
    return next;
  }
}

/** 6-byte little-endian write. */
function writeUint48LE(buf: Uint8Array, offset: number, value: bigint): void {
  let v = value & BIG_MASK_48;
  for (let i = 0; i < 6; i++) {
    buf[offset + i] = Number(v & BIG_FF);
    v = v >> BigInt(8);
  }
}

/**
 * Constant-time byte comparison. Signature comparisons must not leak
 * timing information.
 */
function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Generate a fresh 32-byte key. Bytes come from `crypto.getRandomValues`
 * which the browser binds to a CSPRNG. The caller owns the returned
 * buffer and is responsible for zeroizing it after use.
 */
export function generateRandomKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Short fingerprint for display. First 8 hex chars of SHA-256 over the
 * key. Safe to log, store in non-sensitive columns, and show in the UI.
 */
export async function keyFingerprint(keyBytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer to satisfy BufferSource in all lib.dom typings.
  const copy = new Uint8Array(keyBytes.length);
  copy.set(keyBytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Convert raw key bytes to lowercase hex. Used exactly once per key:
 * right before POST /api/mavlink/signing/enroll-fc. The returned string
 * is sensitive and should be zeroized from the caller's memory after
 * the request completes.
 */
export function keyBytesToHex(keyBytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < keyBytes.length; i++) {
    hex += keyBytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Zeroize a Uint8Array in place. JS does not guarantee memory is reclaimed
 * or overwritten promptly, but we overwrite the buffer we have a handle to
 * so subsequent reads through the same reference read zeros.
 */
export function zeroize(buf: Uint8Array): void {
  buf.fill(0);
}

/**
 * Subscribe to cross-tab signing-active announcements. Returns an
 * unsubscribe function. Useful for UI hints like "signing is active in
 * another tab" without coordinating ownership directly.
 */
export function subscribeSigningBroadcasts(
  handler: (msg: SigningBroadcastMessage) => void,
): () => void {
  const ch = broadcastChannel();
  if (!ch) return () => {};
  const listener = (event: MessageEvent<SigningBroadcastMessage>) => {
    if (!event.data || event.data.type !== "signing-active") return;
    if (event.data.tabId === tabId()) return; // ignore self
    handler(event.data);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}

/** Current tab's id. Stable for the lifetime of the page. */
export function currentTabId(): string {
  return tabId();
}
