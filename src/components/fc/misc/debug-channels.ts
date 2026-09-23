/**
 * Accumulates the Debug panel's named values from the telemetry rings.
 *
 * The rings keep a fixed number of samples and are mutated in place, so their
 * length stops changing once full. Draining by timestamp cursor instead picks
 * up every sample pushed since the last drain, however full the ring is.
 *
 * @module fc/misc/debug-channels
 * @license GPL-3.0-only
 */

import { RingBuffer } from "@/lib/ring-buffer";
import type { DebugValue, HistoryPoint } from "./debug-helpers";
import { MAX_HISTORY } from "./debug-helpers";

/** What one ring sample contributes to a named channel. */
export interface DebugEntry {
  key: string;
  type: DebugValue["type"];
  value: number | null;
}

export class DebugChannels {
  readonly values = new Map<string, DebugValue>();
  private readonly history = new Map<string, RingBuffer<HistoryPoint>>();
  private readonly cursors = new Map<string, number>();

  /**
   * Fold every sample of `samples` (oldest first) newer than the last drain of
   * `source` into its channel. Returns true when anything new was seen.
   */
  drain<T>(
    source: string,
    samples: readonly T[],
    tsOf: (sample: T) => number,
    entryOf: (sample: T) => DebugEntry,
  ): boolean {
    const cursor = this.cursors.get(source) ?? -Infinity;
    // Walk back to the first sample past the cursor; the rest are already in.
    let first = samples.length;
    while (first > 0 && tsOf(samples[first - 1]) > cursor) first--;
    if (first === samples.length) return false;
    for (let i = first; i < samples.length; i++) {
      const ts = tsOf(samples[i]);
      const { key, type, value } = entryOf(samples[i]);
      if (value === null || !Number.isFinite(value)) continue;
      let ring = this.history.get(key);
      if (!ring) {
        ring = new RingBuffer<HistoryPoint>(MAX_HISTORY);
        this.history.set(key, ring);
      }
      const last = ring.latest();
      if (!last || ts > last.t) ring.push({ t: ts, v: value });
      this.values.set(key, { name: key, value, type, lastUpdate: ts });
    }
    this.cursors.set(source, tsOf(samples[samples.length - 1]));
    return true;
  }

  historyOf(key: string): HistoryPoint[] {
    return this.history.get(key)?.toArray() ?? [];
  }

  /** Every channel's history, for export. */
  allHistory(): Map<string, HistoryPoint[]> {
    const out = new Map<string, HistoryPoint[]>();
    for (const [key, ring] of this.history) out.set(key, ring.toArray());
    return out;
  }

  /** Forget the values; samples already drained are not read again. */
  clear(): void {
    this.values.clear();
    this.history.clear();
  }

  /** Forget the values and the cursors (the rings now hold another drone's data). */
  reset(): void {
    this.clear();
    this.cursors.clear();
  }
}
