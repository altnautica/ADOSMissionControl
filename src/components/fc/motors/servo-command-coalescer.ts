/**
 * Coalesces slider-driven servo commands.
 *
 * Every DO_SET_SERVO is an acknowledged command in the shared command queue.
 * A slider drag produces dozens of values a second; sending each one fills the
 * queue on a slow link and unrelated commands (a mode change) fail with
 * "queue full". This keeps at most one command in flight, spaces commands at
 * least `intervalMs` apart, and for each output sends only the latest value
 * requested since the last send.
 *
 * @module fc/motors/servo-command-coalescer
 * @license GPL-3.0-only
 */

import type { CommandResult } from "@/lib/protocol/types";

export const SERVO_SEND_INTERVAL_MS = 100;

type SendServo = (output: number, pwm: number) => Promise<CommandResult>;

export class ServoCommandCoalescer {
  private readonly pending = new Map<number, number>();
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly send: SendServo,
    private readonly intervalMs: number = SERVO_SEND_INTERVAL_MS,
  ) {}

  /** Request `pwm` on `output`; replaces any value still waiting for it. */
  request(output: number, pwm: number): void {
    if (this.disposed) return;
    // Re-insert so the output that changed longest ago is served first.
    this.pending.delete(output);
    this.pending.set(output, pwm);
    this.pump();
  }

  /** Drop anything not yet sent; later completions send nothing. */
  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private pump(): void {
    if (this.disposed || this.inFlight || this.timer) return;
    const next = this.pending.entries().next();
    if (next.done) return;
    const [output, pwm] = next.value;
    this.pending.delete(output);
    this.inFlight = true;
    const startedAt = Date.now();
    void this.send(output, pwm)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = false;
        if (this.disposed) return;
        const wait = Math.max(0, this.intervalMs - (Date.now() - startedAt));
        this.timer = setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
      });
  }
}
