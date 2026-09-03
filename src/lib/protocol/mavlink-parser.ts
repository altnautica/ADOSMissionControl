/**
 * MAVLink v2 binary frame parser.
 *
 * Accumulates raw bytes from a transport, scans for 0xFD start markers,
 * validates CRC-16/MCRF4XX checksums (with per-message CRC_EXTRA seed),
 * handles MAVLink v2 zero-trimmed payload restoration, and emits typed
 * `MAVLinkFrame` objects to subscribers.
 *
 * @module protocol/mavlink-parser
 */

import { CRC_EXTRA, PAYLOAD_LENGTHS } from "./mavlink-crc-extra";

// Re-export for consumers that import CRC_EXTRA from this module
export { CRC_EXTRA, PAYLOAD_LENGTHS };

// ── MAVLink v2 Constants ────────────────────────────────────

/** MAVLink v2 start-of-frame marker. */
const MAVLINK_STX = 0xfd;

/** Fixed header size: STX(1) + len(1) + inc_flags(1) + cmp_flags(1) + seq(1) + sysid(1) + compid(1) + msgid(3) = 10 */
const HEADER_SIZE = 10;

/** CRC size in bytes. */
const CRC_SIZE = 2;

// ── CRC-16/MCRF4XX ─────────────────────────────────────────

/**
 * Compute CRC-16/MCRF4XX (X.25) used by MAVLink.
 * Polynomial 0x1021, init 0xFFFF, no final XOR.
 */
export function crc16(data: Uint8Array, start: number, length: number): number {
  let crc = 0xffff;
  for (let i = start; i < start + length; i++) {
    let tmp = data[i] ^ (crc & 0xff);
    tmp ^= (tmp << 4) & 0xff;
    crc = ((crc >> 8) & 0xff) ^ (tmp << 8) ^ (tmp << 3) ^ ((tmp >> 4) & 0xf);
    crc &= 0xffff;
  }
  return crc;
}

/**
 * Accumulate a single byte into a running CRC-16/MCRF4XX value.
 * Used when we need to feed the CRC_EXTRA byte separately.
 */
export function crc16Accumulate(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff);
  tmp ^= (tmp << 4) & 0xff;
  crc = ((crc >> 8) & 0xff) ^ (tmp << 8) ^ (tmp << 3) ^ ((tmp >> 4) & 0xf);
  return crc & 0xffff;
}

// ── Frame Type ──────────────────────────────────────────────

/** A parsed MAVLink v2 frame. */
export interface MAVLinkFrame {
  /** MAVLink message ID (0–16777215). */
  msgId: number;
  /** Sender system ID. */
  systemId: number;
  /** Sender component ID. */
  componentId: number;
  /** Packet sequence number (0–255). */
  sequence: number;
  /** Payload as a little-endian DataView (zero-restored to canonical length). */
  payload: DataView;
  /** Local timestamp (ms) when the frame was parsed. */
  timestamp: number;
}

type FrameCallback = (frame: MAVLinkFrame) => void;

/**
 * Observer called each time a MAVLink v2 frame with the signed bit set
 * is accepted (CRC valid). Used purely for observability today
 * (rxSignedCount). A future signer-backed validator can wrap this
 * observer to add async HMAC verification.
 */
export type SignedFrameObserver = (ctx: {
  msgId: number;
  systemId: number;
  componentId: number;
  linkId: number;
  /** The 13-byte signature tail (link_id + timestamp + sig). */
  sigTail: Uint8Array;
  /**
   * The signed region that was hashed: header excluding STX, payload, CRC.
   * A copy, safe to retain past the callback return.
   */
  signedRegion: Uint8Array;
}) => void;

// ── Parser ──────────────────────────────────────────────────

/**
 * Streaming MAVLink v2 parser.
 *
 * Feed raw bytes via `feed()`. The parser accumulates them in an
 * internal buffer, scans for 0xFD markers, validates each candidate
 * frame (length, CRC), restores zero-trimmed payloads, and emits
 * `MAVLinkFrame` objects to registered callbacks.
 *
 * @example
 * ```ts
 * const parser = new MAVLinkParser();
 * const unsub = parser.onFrame((frame) => {
 *   console.log(`msg ${frame.msgId} from sys ${frame.systemId}`);
 * });
 * transport.on("data", (bytes) => parser.feed(bytes));
 * ```
 */
export class MAVLinkParser {
  private buffer: Uint8Array;
  private writePos = 0;
  private callbacks: FrameCallback[] = [];
  private signedObservers: SignedFrameObserver[] = [];
  private crcFailures = 0;

  constructor(initialCapacity = 4096) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  /**
   * Feed raw bytes from the transport into the parser.
   * Triggers frame parsing and callback emission synchronously.
   */
  feed(data: Uint8Array): void {
    this.ensureCapacity(data.length);
    this.buffer.set(data, this.writePos);
    this.writePos += data.length;
    this.parseFrames();
  }

  /** Subscribe to parsed frames. Returns an unsubscribe function. */
  onFrame(callback: FrameCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  /**
   * Subscribe to signed v2 frames for counter / verification hooks. The
   * observer fires AFTER CRC validation and AFTER regular frame callbacks.
   * Returns an unsubscribe function.
   */
  onSignedFrame(observer: SignedFrameObserver): () => void {
    this.signedObservers.push(observer);
    return () => {
      const idx = this.signedObservers.indexOf(observer);
      if (idx !== -1) this.signedObservers.splice(idx, 1);
    };
  }

  /**
   * How many candidate frames failed CRC since the last {@link reset}.
   *
   * This replaced a `console.debug` inside the parse loop that fired per
   * mismatched COMMAND_ACK: on a noisy link that is an unbounded console write
   * inside `feed()`, and it was only ever readable by someone with devtools
   * open at the right moment. A counter is cheap, bounded, and something a
   * diagnostics surface can actually show.
   */
  get crcFailureCount(): number {
    return this.crcFailures;
  }

  /** Clear the internal buffer and discard any partial frames. */
  reset(): void {
    this.writePos = 0;
    this.crcFailures = 0;
  }

  // ── Internal ────────────────────────────────────────────

  private ensureCapacity(additional: number): void {
    const needed = this.writePos + additional;
    if (needed <= this.buffer.length) return;

    // Double the buffer (or more if needed)
    let newSize = this.buffer.length * 2;
    while (newSize < needed) newSize *= 2;

    const newBuf = new Uint8Array(newSize);
    newBuf.set(this.buffer.subarray(0, this.writePos));
    this.buffer = newBuf;
  }

  private parseFrames(): void {
    let readPos = 0;

    while (readPos < this.writePos) {
      // Scan for STX
      if (this.buffer[readPos] !== MAVLINK_STX) {
        readPos++;
        continue;
      }

      // Need at least the header to know payload length
      if (this.writePos - readPos < HEADER_SIZE) break;

      const payloadLen = this.buffer[readPos + 1];
      const frameLen = HEADER_SIZE + payloadLen + CRC_SIZE;

      // Wait for full frame
      if (this.writePos - readPos < frameLen) break;

      // Extract header fields
      const incFlags = this.buffer[readPos + 2];
      const _cmpFlags = this.buffer[readPos + 3];
      const seq = this.buffer[readPos + 4];
      const sysId = this.buffer[readPos + 5];
      const compId = this.buffer[readPos + 6];
      const msgId =
        this.buffer[readPos + 7] |
        (this.buffer[readPos + 8] << 8) |
        (this.buffer[readPos + 9] << 16);

      // Signature handling — if incompatibility flag bit 0 is set, 13 extra bytes follow CRC
      const signatureLen = (incFlags & 0x01) ? 13 : 0;
      const totalLen = frameLen + signatureLen;
      if (this.writePos - readPos < totalLen) break;

      // Validate CRC
      const crcExtra = CRC_EXTRA.get(msgId);
      if (crcExtra === undefined) {
        // Unknown message — advance ONE byte and keep scanning.
        //
        // Deliberate, and do not "optimise" it into a `readPos += totalLen`
        // skip. With no CRC_EXTRA there is no way to validate that this is a
        // frame at all: the 0xFD may be a payload byte of the frame we are
        // actually inside. Skipping the header's claimed length would then
        // discard up to 255 bytes of real stream. Every reference
        // implementation resyncs by one byte for the same reason.
        readPos++;
        continue;
      }

      // CRC covers bytes 1..(HEADER_SIZE + payloadLen - 1), i.e. everything except STX and CRC itself
      let crc = crc16(this.buffer, readPos + 1, HEADER_SIZE - 1 + payloadLen);
      crc = crc16Accumulate(crcExtra, crc);

      const wireCrcLo = this.buffer[readPos + HEADER_SIZE + payloadLen];
      const wireCrcHi = this.buffer[readPos + HEADER_SIZE + payloadLen + 1];
      const wireCrc = wireCrcLo | (wireCrcHi << 8);

      if (crc !== wireCrc) {
        // CRC mismatch — this is not a valid frame at this offset. Same
        // one-byte resync, same reason as above.
        this.crcFailures++;
        readPos++;
        continue;
      }

      // Extract payload (restore zero-trimmed trailing bytes)
      const expectedLen = PAYLOAD_LENGTHS.get(msgId) ?? payloadLen;
      const restored = new Uint8Array(expectedLen);
      const copyLen = Math.min(payloadLen, expectedLen);
      restored.set(
        this.buffer.subarray(readPos + HEADER_SIZE, readPos + HEADER_SIZE + copyLen),
      );
      // Remaining bytes stay zero (Uint8Array is zero-initialized)

      const frame: MAVLinkFrame = {
        msgId,
        systemId: sysId,
        componentId: compId,
        sequence: seq,
        payload: new DataView(restored.buffer, restored.byteOffset, restored.byteLength),
        timestamp: Date.now(),
      };

      // Emit. A throwing callback must not unwind through parseFrames and
      // skip the remaining buffered frames or the buffer compaction below;
      // isolate each subscriber the same way signed observers are isolated.
      for (const cb of this.callbacks) {
        try {
          cb(frame);
        } catch (err) {
          console.warn('[MAVLink] frame callback threw, continuing parse', err);
        }
      }

      // Signed-frame observers: fire after frame emission. Copy the
      // signed region and signature tail into fresh buffers so observers
      // can retain them past this tick without aliasing into our rolling
      // parse buffer.
      if (signatureLen === 13 && this.signedObservers.length > 0) {
        const signedStart = readPos + 1;
        const signedEnd = readPos + HEADER_SIZE + payloadLen + CRC_SIZE;
        const signedRegion = this.buffer.slice(signedStart, signedEnd);
        const sigTail = this.buffer.slice(signedEnd, signedEnd + 13);
        const linkId = sigTail[0];
        for (const obs of this.signedObservers) {
          try {
            obs({ msgId, systemId: sysId, componentId: compId, linkId, sigTail, signedRegion });
          } catch {
            // Observers must not take down the parser.
          }
        }
      }

      readPos += totalLen;
    }

    // Compact buffer — move unconsumed bytes to front
    if (readPos > 0) {
      if (readPos < this.writePos) {
        this.buffer.copyWithin(0, readPos, this.writePos);
      }
      this.writePos -= readPos;
    }
  }
}
