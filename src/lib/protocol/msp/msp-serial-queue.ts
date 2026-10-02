/**
 * MSP serial request queue.
 *
 * MSP is a request/response protocol with one outstanding request at a time.
 * This queue serializes concurrent send() calls and matches each reply to its
 * request, with timeout and retry.
 *
 * A retry sends a second copy of the request, so a reply that was only late
 * can arrive after the next request of the same command went active. Where
 * the reply names what it answers (a waypoint number, a slot index) the caller
 * passes `accept` and a reply for another key is dropped. For keyless
 * commands the queue counts the copies still owed a reply per command and
 * drops that many replies before it resolves the next request.
 *
 * @module protocol/msp/msp-serial-queue
 */

import { encodeMsp } from './msp-codec';
import type { MspParser, ParsedMspFrame } from './msp-parser';

// ── Types ──────────────────────────────────────────────────

/** True when a reply frame answers this particular request. */
export type MspReplyMatcher = (frame: ParsedMspFrame) => boolean;

interface PendingRequest {
  command: number;
  payload: Uint8Array | undefined;
  accept: MspReplyMatcher | undefined;
  resolve: (frame: ParsedMspFrame) => void;
  reject: (error: Error) => void;
  retries: number;
}

// ── Queue Class ────────────────────────────────────────────

export class MspSerialQueue {
  private queue: PendingRequest[] = [];
  private active: PendingRequest | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsolicitedCbs: ((frame: ParsedMspFrame) => void)[] = [];
  /** Per command, the expiry time of each sent copy still owed a reply by a settled request. */
  private lateReplies = new Map<number, number[]>();
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    private sendFn: (data: Uint8Array) => void,
    parser: MspParser,
    timeout = 1000,
    maxRetries = 2,
  ) {
    this.timeoutMs = timeout;
    this.maxRetries = maxRetries;

    // Subscribe to parsed frames
    this.unsubscribe = parser.onFrame((frame) => this.handleFrame(frame));
  }

  /**
   * Send an MSP command and wait for its reply. If another request is in
   * flight, this queues behind it. `accept` identifies the reply when the
   * reply carries the request's key.
   */
  send(command: number, payload?: Uint8Array, accept?: MspReplyMatcher): Promise<ParsedMspFrame> {
    const { promise, resolve, reject } = Promise.withResolvers<ParsedMspFrame>();
    this.queue.push({ command, payload, accept, resolve, reject, retries: 0 });
    this.processNext();
    return promise;
  }

  /**
   * Send without waiting for response (fire-and-forget).
   * Used for high-frequency commands like MSP_SET_RAW_RC.
   * Does NOT go through the queue; sends immediately.
   */
  sendNoReply(command: number, payload?: Uint8Array): void {
    const encoded = encodeMsp(command, payload);
    this.sendFn(encoded);
  }

  /**
   * Flush all pending requests. Rejects them with "Disconnected".
   * Call on transport disconnect.
   */
  flush(): void {
    this.clearTimeout();

    if (this.active) {
      this.active.reject(new Error('Disconnected'));
      this.active = null;
    }

    for (const req of this.queue) {
      req.reject(new Error('Disconnected'));
    }
    this.queue.length = 0;
    this.lateReplies.clear();
  }

  /** Number of pending requests (including the active one). */
  get pending(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }

  /** Unsubscribe from parser and flush. Call on cleanup. */
  destroy(): void {
    this.flush();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // ── Internal ─────────────────────────────────────────────

  private processNext(): void {
    if (this.active || this.queue.length === 0) return;

    this.active = this.queue.shift()!;
    this.sendActive();
  }

  /**
   * Write the active request and arm its timeout. A write that throws (the
   * transport closed, a serial or BLE write error) fails that request and
   * moves on; left active with no timer, it would block every later request.
   */
  private sendActive(): void {
    const req = this.active;
    if (!req) return;
    try {
      this.sendFn(encodeMsp(req.command, req.payload));
    } catch (err) {
      this.clearTimeout();
      this.active = null;
      req.reject(err instanceof Error ? err : new Error(String(err)));
      this.processNext();
      return;
    }
    this.startTimeout();
  }

  private handleFrame(frame: ParsedMspFrame): void {
    const req = this.active;
    if (req && frame.command === req.command && this.answersActive(req, frame)) {
      this.clearTimeout();
      this.active = null;
      // Copies of this request sent before the one just answered may still
      // draw replies; those must not answer the next request.
      if (!req.accept) this.noteLateReplies(req.command, req.retries);
      // An MSP error frame ($X!/$M!) means the FC rejected the command — reject
      // so a failed setting write surfaces instead of reading as saved.
      if (frame.direction === 'error') {
        req.reject(new Error(`MSP error for command ${frame.command}`));
      } else {
        req.resolve(frame);
      }
      this.processNext();
      return;
    }
    if (req && frame.command === req.command) return; // a late reply to an earlier request
    // A late reply to a settled request arriving while another command is in
    // flight is not a push; drop it and settle the debt.
    if (this.takeLateReply(frame.command)) return;
    // Anything else is unsolicited (e.g. DisplayPort pushes, telemetry) — fan
    // out to subscribers, who filter by command.
    for (const cb of this.unsolicitedCbs) cb(frame);
  }

  /** Whether a same-command frame answers `req` rather than an earlier request. */
  private answersActive(req: PendingRequest, frame: ParsedMspFrame): boolean {
    if (req.accept && frame.direction !== 'error') {
      try {
        return req.accept(frame);
      } catch {
        return false; // a reply too short to decode answers nothing
      }
    }
    return !this.takeLateReply(frame.command);
  }

  /** Consume one owed late reply for `command`; false when none is owed. */
  private takeLateReply(command: number): boolean {
    const owed = this.lateReplies.get(command);
    if (!owed) return false;
    const now = Date.now();
    while (owed.length > 0 && owed[0] <= now) owed.shift();
    const owedOne = owed.length > 0;
    if (owedOne) owed.shift();
    if (owed.length === 0) this.lateReplies.delete(command);
    return owedOne;
  }

  /** Record `copies` sent copies of `command` that may still draw a reply. */
  private noteLateReplies(command: number, copies: number): void {
    if (copies <= 0) return;
    const owed = this.lateReplies.get(command) ?? [];
    const expiry = Date.now() + this.timeoutMs * (this.maxRetries + 1);
    for (let i = 0; i < copies; i++) owed.push(expiry);
    this.lateReplies.set(command, owed);
  }

  /** Subscribe to frames not matched to a pending request. Returns unsubscribe. */
  onUnsolicited(cb: (frame: ParsedMspFrame) => void): () => void {
    this.unsolicitedCbs.push(cb);
    return () => {
      const i = this.unsolicitedCbs.indexOf(cb);
      if (i !== -1) this.unsolicitedCbs.splice(i, 1);
    };
  }

  private startTimeout(): void {
    this.clearTimeout();
    this.timeoutId = setTimeout(() => {
      if (!this.active) return;

      if (this.active.retries < this.maxRetries) {
        this.active.retries++;
        this.sendActive();
      } else {
        const req = this.active;
        this.active = null;
        if (!req.accept) this.noteLateReplies(req.command, req.retries + 1);
        req.reject(
          new Error(`MSP timeout: command ${req.command} after ${this.maxRetries + 1} attempts`),
        );
        this.processNext();
      }
    }, this.timeoutMs);
  }

  private clearTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
