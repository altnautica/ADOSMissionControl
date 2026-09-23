/**
 * MAVLink v2 frame builder and sequence counter.
 * @module protocol/encoders/frame
 */

import { CRC_EXTRA, crc16, crc16Accumulate } from "../mavlink-parser";

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
 * CRC at send time.
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
 * Assemble a complete, unsigned MAVLink v2 frame.
 *
 * Signing happens on the send path (`MavlinkSigner.signFrame`), which sets
 * the signed flag, recomputes the CRC and appends the signature tail.
 *
 * @param msgId   - 24-bit message ID
 * @param payload - Serialised payload bytes
 * @param sysId   - Sender system ID (default 255 = GCS)
 * @param compId  - Sender component ID (default 190 = MAV_COMP_ID_MISSIONPLANNER)
 * @param seq     - Explicit sequence number (auto-incremented if omitted)
 * @returns Complete frame ready to send over the transport.
 */
export function buildFrame(
  msgId: number,
  payload: Uint8Array,
  sysId = 255,
  compId = 190,
  seq?: number,
): Uint8Array {
  const payloadLen = payload.length;
  const frame = new Uint8Array(10 + payloadLen + 2);

  frame[0] = 0xfd;
  frame[1] = payloadLen;
  frame[2] = 0x00;
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

  return frame;
}
