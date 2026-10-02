/**
 * @module telemetry/freshness
 * @description Freshness gating for MAVLink telemetry samples.
 *
 * Every ring buffer in `telemetry-store` keeps its last sample forever, and
 * `latest()` returns it whether it arrived 40 ms or 40 minutes ago. That is
 * the right behaviour for a buffer and the wrong behaviour for a surface: a
 * safety band, a telemetry strip, and a proximity radar that read `latest()`
 * directly keep painting the last battery percentage, the last GPS fix, and
 * the last obstacle arcs after the link is gone, indefinitely, with no
 * indication that nothing behind them is moving.
 *
 * `@/lib/agent/freshness` is the sibling module for *agent heartbeat*
 * freshness, on a 45 s threshold sized for heartbeats that arrive every 5-14 s
 * on a loaded SBC. MAVLink telemetry is a different regime — 1 to 10 Hz — so
 * it gets its own threshold rather than borrowing one that would call a
 * forty-second-old battery reading live.
 *
 * @license GPL-3.0-only
 */

/**
 * A telemetry sample older than this is not shown as a live value.
 *
 * Deliberately the same 5 s the protocol adapter uses to declare a MAVLink
 * link lost (`HEARTBEAT_TIMEOUT_MS`), imported from here so the two cannot
 * drift: it would be incoherent for the adapter to report a dead link while a
 * safety band still called its last reading current. At the slowest stream
 * rate the GCS requests, 5 s is several missed frames, not jitter.
 */
export const TELEMETRY_STALE_MS = 5_000;

/**
 * How far ahead of this browser's clock a sample may be stamped and still be
 * read as fresh: ordinary clock skew between the stamping relay and here.
 */
export const TELEMETRY_FUTURE_SKEW_MS = 2_000;

/** A telemetry sample. Every type in `@/lib/types/telemetry` carries this. */
export interface Timestamped {
  timestamp: number;
}

/**
 * Whether `timestamp` is recent enough to display as a live value.
 *
 * `now` is a parameter rather than a `Date.now()` call so a caller can gate a
 * whole frame of telemetry against one instant, and so this is testable
 * without faking the clock.
 */
export function isFresh(timestamp: number | undefined, now: number): boolean {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  // A sample a little from the future is clock skew between this browser and
  // whatever stamped it. Anything further ahead says nothing about how old
  // the sample really is, so it cannot vouch for a live value: a relay clock
  // running minutes ahead would otherwise keep a dead link's values "live".
  if (age < 0) return -age <= TELEMETRY_FUTURE_SKEW_MS;
  return age < TELEMETRY_STALE_MS;
}

/**
 * The sample if it is fresh, otherwise `undefined`.
 *
 * Collapsing a stale sample to "no sample" is the point: every consumer
 * already renders an honest placeholder for absent telemetry — "--", "NO
 * FIX", zero signal bars, a hidden radar — so gating at the source makes all
 * of them tell the truth without each one growing its own staleness branch.
 */
export function freshOnly<T extends Timestamped>(
  sample: T | undefined,
  now: number,
): T | undefined {
  if (sample === undefined) return undefined;
  return isFresh(sample.timestamp, now) ? sample : undefined;
}
