/**
 * Outbound backlog policy shared by the transports that can fall behind the
 * GCS (BLE writes, a WebSocket over a congested link).
 *
 * A stick or RC-override frame is a level, not an event: once a newer one is
 * waiting, the older one only delays the pilot's input. Those frames coalesce
 * (the newest replaces the queued one of the same kind). Every other frame
 * keeps its place, and the backlog is bounded so a stalled link refuses new
 * sends instead of playing them out seconds late.
 *
 * @module protocol/transport/send-backlog
 */

/** Most frames a transport holds unsent before it refuses new ones. */
export const SEND_BACKLOG_MAX_FRAMES = 64;

const MAVLINK_V1_MAGIC = 0xfe;
const MAVLINK_V2_MAGIC = 0xfd;
const MAVLINK_MANUAL_CONTROL = 69;
const MAVLINK_RC_CHANNELS_OVERRIDE = 70;
const MSP_SET_RAW_RC = 200;

/**
 * The coalescing key of a superseded-by-newer control frame (MAVLink
 * MANUAL_CONTROL / RC_CHANNELS_OVERRIDE, MSP_SET_RAW_RC), or null for any
 * other frame.
 */
export function controlFrameKey(frame: Uint8Array): string | null {
  if (frame.length >= 6 && frame[0] === MAVLINK_V1_MAGIC) {
    const msgId = frame[5];
    return msgId === MAVLINK_MANUAL_CONTROL || msgId === MAVLINK_RC_CHANNELS_OVERRIDE ? `mav:${msgId}` : null;
  }
  if (frame.length >= 10 && frame[0] === MAVLINK_V2_MAGIC) {
    const msgId = frame[7] | (frame[8] << 8) | (frame[9] << 16);
    return msgId === MAVLINK_MANUAL_CONTROL || msgId === MAVLINK_RC_CHANNELS_OVERRIDE ? `mav:${msgId}` : null;
  }
  // MSP v1 "$M<" len cmd, MSP v2 "$X<" flag cmdLo cmdHi.
  if (frame.length >= 5 && frame[0] === 0x24 && frame[1] === 0x4d && frame[4] === MSP_SET_RAW_RC) return "msp:rc";
  if (frame.length >= 6 && frame[0] === 0x24 && frame[1] === 0x58 && (frame[4] | (frame[5] << 8)) === MSP_SET_RAW_RC) return "msp:rc";
  return null;
}

/**
 * Add `frame` to `backlog`: replace a queued control frame of the same kind,
 * else append. Throws when the backlog is full.
 */
export function enqueueFrame(backlog: Uint8Array[], frame: Uint8Array, transportName: string): void {
  const key = controlFrameKey(frame);
  if (key !== null) {
    const queued = backlog.findIndex((f) => controlFrameKey(f) === key);
    if (queued !== -1) {
      backlog[queued] = frame;
      return;
    }
  }
  if (backlog.length >= SEND_BACKLOG_MAX_FRAMES) {
    throw new Error(`${transportName} send backlog full (${SEND_BACKLOG_MAX_FRAMES} frames); the link is not keeping up`);
  }
  backlog.push(frame);
}
