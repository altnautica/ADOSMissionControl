/**
 * Uniform path decimation for stored flight tracks.
 *
 * @module flight-lifecycle/decimate
 * @license GPL-3.0-only
 */

/** Most points a stored flight path keeps. */
export const MAX_PATH_POINTS = 1000;

/**
 * Pick at most `max` points spread evenly over the whole of `points`, always
 * keeping the first and the last. A list already within `max` comes back
 * unchanged (same array).
 */
export function decimatePath<T>(points: readonly T[], max: number = MAX_PATH_POINTS): T[] {
  const n = points.length;
  if (n <= max) return points as T[];
  if (max <= 1) return [points[n - 1]];
  const out: T[] = new Array(max);
  const step = (n - 1) / (max - 1);
  for (let i = 0; i < max; i++) out[i] = points[Math.round(i * step)];
  return out;
}
