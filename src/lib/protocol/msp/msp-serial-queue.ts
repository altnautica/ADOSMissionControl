/**
 * MSP serial request queue.
 *
 * MSP is a request/response protocol with one outstanding request at a time.
 * This queue serializes concurrent send() calls, matching responses to
 * requests by command code, with timeout and retry.
 *
 * @module protocol/msp/msp-serial-queue
 */

import { encodeMsp } from './msp-codec';
import type { MspParser, ParsedMspFrame } from './msp-parser';

// ── Types ──────────────────────────────────────────────────

interface PendingRequest {
  command: number;
  payload: Uint8Array | undefined;
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
   * Send an MSP command and wait for matching response.
   * If another request is in flight, this queues behind it.
   */
  send(command: number, payload?: Uint8Array): Promise<ParsedMspFrame> {
    const { promise, resolve, reject } = Promise.withResolvers<ParsedMspFrame>();
    this.queue.push({ command, payload, resolve, reject, retries: 0 });
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
    // A frame matching the in-flight request resolves it.
    if (this.active && frame.command === this.active.command) {
      this.clearTimeout();
      const req = this.active;
      this.active = null;
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
    // Anything else is unsolicited (e.g. DisplayPort pushes, telemetry) — fan
    // out to subscribers, who filter by command.
    for (const cb of this.unsolicitedCbs) cb(frame);
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
