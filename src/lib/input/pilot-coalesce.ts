// The pilot stream's frame sender for one open socket.

import type { PilotOutboundFrame } from "./pilot-stream";

/** The parts of a WebSocket the pilot sender uses. */
export interface PilotSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
}

const SOCKET_OPEN = 1;
/** How often a waiting stick frame checks whether the socket drained. */
const COALESCE_RETRY_MS = 5;

/**
 * The frame sender for one open socket. While the socket still holds unsent
 * bytes, only the newest stick frame waits (an older one is replaced), and
 * it goes out once the buffer drains, so a slow link flies the latest stick
 * rather than a queue of old ones. A release drops the waiting stick frame,
 * so no older stick follows it. Every other frame is sent at once.
 */
export function coalescingSender(socket: PilotSocket): (frame: PilotOutboundFrame) => boolean {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending === null) return;
    if (socket.readyState !== SOCKET_OPEN) {
      pending = null;
      return;
    }
    if (socket.bufferedAmount > 0) {
      timer = setTimeout(flush, COALESCE_RETRY_MS);
      return;
    }
    socket.send(pending);
    pending = null;
  };
  return (frame) => {
    if (socket.readyState !== SOCKET_OPEN) return false;
    if (frame.op === "input" && socket.bufferedAmount > 0) {
      pending = JSON.stringify(frame);
      timer ??= setTimeout(flush, COALESCE_RETRY_MS);
      return true;
    }
    if (frame.op === "input" || frame.op === "release") pending = null;
    socket.send(JSON.stringify(frame));
    return true;
  };
}
