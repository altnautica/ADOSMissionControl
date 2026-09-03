/**
 * MAVLink v2 frame builder and sequence counter.
 * @module protocol/encoders/frame
 */

import { CRC_EXTRA, crc16, crc16Accumulate } from "../mavlink-parser";
import type { MavlinkSigner } from "../mavlink-signer";

// ── Sequence Counter ────────────────────────────────────────

/**
 * Send-sequence counters, keyed by sending (sysId, compId).
 *
 * MAVLink's sequence byte is scoped to the SENDING system/component: a
 * receiver uses it to detect loss from that source, which is how ArduPilot
 * computes GCS-to-FC packet loss. A single global counter shared by every
 * sender therefore reports fiction as soon as a second sender exists — each
 * receiver sees a stream with holes where the other sender's frames went.
 *
 * Known remaining gap: one GCS identity sending to two vehicles over two
 * links still splits one counter across both, so each vehicle sees holes.
 * Fixing that needs a counter per DESTINATION, which means either threading a
 * seq through every encoder signature or rewriting byte 4 and recomputing the
 * CRC at send time. Tracked in tasks/inbox.md rather than done here.
 */
const sequences = new Map<number, number>();

/** Sequence counters are per sender; the key packs (sysId, compId). */
export function nextSequence(sysId = 255, compId = 190): number {
  const key = (sysId << 8) | compId;
  const seq = sequences.get(key) ?? 0;
  sequences.set(key, (seq + 1) & 0xff);
  return seq;
}

/** Reset every counter. For tests and for a full teardown. */
export function resetSequences(): void {
  sequences.clear();
}

// ── Frame Builder ───────────────────────────────────────────

/**
 * Assemble a complete MAVLink v2 frame, optionally signed.
 *
 * When `signer` is supplied, the frame has the MAVLINK_IFLAG_SIGNED bit
 * set in INC_FLAGS and a 13-byte signature tail appended after the CRC.
 * When omitted, the frame is emitted unsigned exactly as before.
 *
 * @param msgId   - 24-bit message ID
 * @param payload - Serialised payload bytes
 * @param sysId   - Sender system ID (default 255 = GCS)
 * @param compId  - Sender component ID (default 190 = MAV_COMP_ID_MISSIONPLANNER)
 * @param seq     - Explicit sequence number (auto-incremented if omitted)
 * @param signer  - Optional MavlinkSigner. When provided, the frame is signed.
 * @returns Complete frame ready to send over the transport. Signed
 *          frames resolve asynchronously.
 */
export function buildFrame(
  msgId: number,
  payload: Uint8Array,
  sysId?: number,
  compId?: number,
  seq?: number,
): Uint8Array;
export function buildFrame(
  msgId: number,
  payload: Uint8Array,
  sysId: number | undefined,
  compId: number | undefined,
  seq: number | undefined,
  signer: MavlinkSigner,
): Promise<Uint8Array>;
export function buildFrame(
  msgId: number,
  payload: Uint8Array,
  sysId = 255,
  compId = 190,
  seq?: number,
  signer?: MavlinkSigner,
): Uint8Array | Promise<Uint8Array> {
  const payloadLen = payload.length;
  const unsignedLen = 10 + payloadLen + 2;
  const frame = new Uint8Array(signer ? unsignedLen + 13 : unsignedLen);

  // Header. INC_FLAGS bit 0 marks the frame as signed. The bit is part of
  // the hashed region, so it MUST be set before computing the signature.
  frame[0] = 0xfd;
  frame[1] = payloadLen;
  frame[2] = signer ? 0x01 : 0x00;
  frame[3] = 0;
  frame[4] = seq ?? nextSequence(sysId, compId);
  frame[5] = sysId;
  frame[6] = compId;
  frame[7] = msgId & 0xff;
  frame[8] = (msgId >> 8) & 0xff;
  frame[9] = (msgId >> 16) & 0xff;

  frame.set(payload, 10);

  let crc = crc16(frame, 1, 9 + payloadLen);
  const extra = CRC_EXTRA.get(msgId);
  if (extra === undefined) {
    // Without the seed the frame carries a CRC the receiver cannot match, so
    // it is silently rejected on arrival and the caller is told nothing. That
    // is worse than a throw: an encoder added for a message missing from the
    // table looked like it worked.
    throw new Error(`buildFrame: no CRC_EXTRA seed for message id ${msgId}`);
  }
  crc = crc16Accumulate(extra, crc);
  frame[10 + payloadLen] = crc & 0xff;
  frame[10 + payloadLen + 1] = (crc >> 8) & 0xff;

  if (!signer) {
    return frame;
  }

  // Signed path. The signed region is bytes 1..end-of-CRC (i.e. header
  // excluding STX, payload, CRC). Call the async signer and splice the
  // 13-byte tail onto the end of the frame buffer before returning.
  const signedRegion = frame.subarray(1, unsignedLen);
  return signer.sign(signedRegion).then((tail) => {
    frame.set(tail, unsignedLen);
    return frame;
  });
}
