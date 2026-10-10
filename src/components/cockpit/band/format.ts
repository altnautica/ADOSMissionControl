/**
 * Small formatting helpers shared by the cockpit safety band.
 *
 * @license GPL-3.0-only
 */

/** Milliseconds since `start` on the wall clock, never negative. */
export function msSince(start: number): number {
  return Math.max(0, Date.now() - start);
}

/** m:ss for an elapsed duration in milliseconds. */
export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
