/**
 * MSP link-loss detection.
 *
 * MSP has no heartbeat: the FC only ever answers requests. The link counts as
 * lost when the FC has sent nothing for MSP_LINK_SILENCE_MS while a request
 * is waiting on it, or when MSP_STATUS_FAILURES_FOR_LOSS consecutive 1 Hz
 * MSP_STATUS probes fail. Any reply restores it. While `paused()` holds (the
 * CLI owns the port and the FC speaks plain text) nothing is judged.
 *
 * @module protocol/msp/msp-link-monitor
 */

import { MSP } from './msp-constants';
import type { MspParser } from './msp-parser';
import type { MspSerialQueue } from './msp-serial-queue';

/** Silence, with a request outstanding, after which the link is lost. */
export const MSP_LINK_SILENCE_MS = 3000;
/** Cadence of the liveness check and the MSP_STATUS probe. */
export const MSP_STATUS_PROBE_MS = 1000;
/** Consecutive failed MSP_STATUS probes after which the link is lost. */
export const MSP_STATUS_FAILURES_FOR_LOSS = 3;

export interface MspLinkMonitorDeps {
  queue: MspSerialQueue;
  parser: MspParser;
  /** True while MSP is not spoken on the port (CLI session). */
  paused: () => boolean;
  onLost: () => void;
  onRestored: () => void;
}

export class MspLinkMonitor {
  private lastReplyAt = Date.now();
  private failedProbes = 0;
  private probeInFlight = false;
  private lost = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: MspLinkMonitorDeps) {}

  start(): void {
    if (this.timer) return;
    this.lastReplyAt = Date.now();
    this.unsubscribe = this.deps.parser.onFrame(() => this.onReply());
    this.timer = setInterval(() => this.tick(), MSP_STATUS_PROBE_MS);
  }

  stop(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onReply(): void {
    this.lastReplyAt = Date.now();
    this.failedProbes = 0;
    if (!this.lost) return;
    this.lost = false;
    this.deps.onRestored();
  }

  private tick(): void {
    if (this.deps.paused()) {
      // The CLI's text traffic is the FC answering; judge afresh afterwards.
      this.lastReplyAt = Date.now();
      this.failedProbes = 0;
      return;
    }
    const silent = Date.now() - this.lastReplyAt > MSP_LINK_SILENCE_MS;
    if (silent && this.deps.queue.pending > 0) this.markLost();
    if (this.probeInFlight) return;
    this.probeInFlight = true;
    this.deps.queue.send(MSP.MSP_STATUS).then(
      () => { this.probeInFlight = false; },
      () => {
        this.probeInFlight = false;
        if (!this.timer || this.deps.paused()) return;
        this.failedProbes++;
        if (this.failedProbes >= MSP_STATUS_FAILURES_FOR_LOSS) this.markLost();
      },
    );
  }

  private markLost(): void {
    if (this.lost) return;
    this.lost = true;
    this.deps.onLost();
  }
}
