/**
 * Browser-side MAVLink v2 message signer.
 *
 * Every outgoing v2 frame gains a 13-byte signature tail:
 *     [link_id: 1B] [timestamp: 6B LE] [signature: 6B]
 *
 * The signature is the first 6 bytes of
 *     HMAC-SHA256(secret_key, header || payload || CRC || link_id || timestamp)
 *
 * Timestamp is unsigned 48-bit little-endian, counts 10-microsecond units
 * since 2015-01-01 00:00:00 UTC. It MUST strictly increase per (sender,
 * link_id) pair. The signer tracks the last emitted timestamp in memory
 * and clamps forward-only: a system clock that jumps backward (or two
 * sign() calls arriving within the same millisecond) never causes a
 * regression.
 *
 * The CryptoKey is non-extractable. JS cannot read its raw bytes back
 * even if an XSS payload gains same-origin execution.
 *
 * @module protocol/mavlink-signer
 */

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

/**
 * One signer instance per (droneId, linkId). The outgoing-timestamp counter
 * is per-instance.
 */
export class MavlinkSigner {
  readonly droneId: string;
  readonly linkId: number;
  readonly keyId: string;
  private readonly cryptoKey: CryptoKey;
  private lastTimestamp: bigint = BIG_ZERO;

  constructor(droneId: string, linkId: number, keyId: string, cryptoKey: CryptoKey) {
    if (linkId < 0 || linkId > 255) {
      throw new Error(`linkId must fit in one byte (0..255), got ${linkId}`);
    }
    this.droneId = droneId;
    this.linkId = linkId;
    this.keyId = keyId;
    this.cryptoKey = cryptoKey;
  }

  /**
   * Seed the monotonic counter from persisted state. Called on construction
   * when IndexedDB has a cached last-timestamp value for this drone/link.
   * Never lets the counter go backward.
   */
  seedTimestamp(persisted: bigint): void {
    if (persisted > this.lastTimestamp) {
      this.lastTimestamp = persisted;
    }
  }

  /**
   * Read the current monotonic counter for persistence. Does not advance.
   */
  currentTimestamp(): bigint {
    return this.lastTimestamp;
  }

  /**
   * Compute the 13-byte signature tail for a frame whose header + payload
   * + CRC has already been written. The caller appends the returned bytes
   * after the 2-byte CRC.
   *
   * `frameBytesThroughCrc` must be a contiguous byte slice starting at
   * byte 1 of the v2 frame (not the STX) through the end of the CRC. That
   * matches what the MAVLink spec defines as the signed region:
   *     header (9 bytes excluding STX) + payload + CRC (2 bytes).
   *
   * NOTE: the caller is also responsible for setting the
   * MAVLINK_IFLAG_SIGNED bit (0x01) in the INC_FLAGS byte of the frame
   * BEFORE passing the bytes here. The flag is part of the header that
   * gets hashed, so flipping it after signing would invalidate the tag.
   */
  async sign(frameBytesThroughCrc: Uint8Array): Promise<Uint8Array> {
    // Web Locks serialize sign() across tabs of the same browser that open
    // the same drone. Without this, two tabs would each read/advance the
    // persisted timestamp counter independently, and the flight controller
    // would reject whichever frame arrives with the lower timestamp as a
    // replay.
    const lockName = `ados-signing:${this.droneId}:${this.linkId}`;
    return this.withSigningLock(lockName, () => this.signLocked(frameBytesThroughCrc));
  }

  private async signLocked(frameBytesThroughCrc: Uint8Array): Promise<Uint8Array> {
    const timestamp = this.nextTimestamp();
    const tail = new Uint8Array(SIGNATURE_TAIL_LEN);
    tail[0] = this.linkId;
    writeUint48LE(tail, 1, timestamp);

    // hmac_input = frameBytesThroughCrc || link_id || timestamp
    const hmacInput = new Uint8Array(frameBytesThroughCrc.length + 7);
    hmacInput.set(frameBytesThroughCrc, 0);
    hmacInput[frameBytesThroughCrc.length] = this.linkId;
    writeUint48LE(hmacInput, frameBytesThroughCrc.length + 1, timestamp);

    const sigBuf = await crypto.subtle.sign("HMAC", this.cryptoKey, hmacInput);
    tail.set(new Uint8Array(sigBuf).subarray(0, 6), 7);

    // Announce liveness so sibling tabs can render a "signing in another
    // tab" hint. Non-blocking, best-effort.
    this.announceActive();
    return tail;
  }

  /**
   * Acquire the exclusive Web Lock for this drone+linkId, run the callback,
   * release the lock. Falls back to a plain await when Web Locks API is
   * not available (older Safari, test runners without the polyfill).
   */
  private async withSigningLock<T>(
    lockName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const locks = (globalThis as unknown as { navigator?: { locks?: LockManager } }).navigator?.locks;
    if (!locks || typeof locks.request !== "function") {
      return fn();
    }
    return locks.request(lockName, { mode: "exclusive" }, fn) as Promise<T>;
  }

  private _lastAnnouncedAt = 0;
  private announceActive(): void {
    const now = Date.now();
    // Throttle to once per second per signer instance. BroadcastChannel is
    // cheap but the sign() path runs at frame rate.
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
   * Validate the signature on an incoming v2 frame.
   *
   * `frameBytesThroughCrc` is the same signed region as in sign().
   * `sigTail` is the 13 bytes that followed the CRC in the wire frame.
   */
  async verify(frameBytesThroughCrc: Uint8Array, sigTail: Uint8Array): Promise<boolean> {
    if (sigTail.length !== SIGNATURE_TAIL_LEN) return false;
    const rxLinkId = sigTail[0];
    const hmacInput = new Uint8Array(frameBytesThroughCrc.length + 7);
    hmacInput.set(frameBytesThroughCrc, 0);
    hmacInput[frameBytesThroughCrc.length] = rxLinkId;
    hmacInput.set(sigTail.subarray(1, 7), frameBytesThroughCrc.length + 1);

    const full = await crypto.subtle.sign("HMAC", this.cryptoKey, hmacInput);
    const expected = new Uint8Array(full).subarray(0, 6);
    const received = sigTail.subarray(7, 13);
    return constantTimeEquals(expected, received);
  }

  /**
   * Forward-only timestamp. Never reads system clock after the first call
   * in a way that could regress: subsequent calls take max(Date.now(), last+1).
   * A clock that jumps forward then back therefore never regresses it.
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
 * Constant-time byte comparison. HMAC tag comparisons must not leak
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
 * Import raw bytes as a non-extractable HMAC-SHA256 key. The returned
 * CryptoKey cannot be exported back to raw bytes: `crypto.subtle.exportKey`
 * will throw `InvalidAccessError`. The caller should zeroize `keyBytes`
 * immediately after this call returns.
 */
export async function importNonExtractableKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  if (keyBytes.length !== 32) {
    throw new Error(`signing key must be 32 bytes, got ${keyBytes.length}`);
  }
  // Copy into a fresh ArrayBuffer. Narrow Uint8Array<ArrayBufferLike> ->
  // Uint8Array<ArrayBuffer> so the importKey overload resolves cleanly.
  const copy = new Uint8Array(keyBytes.length);
  copy.set(keyBytes);
  return crypto.subtle.importKey(
    "raw",
    copy,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
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
