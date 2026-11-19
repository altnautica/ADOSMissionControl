/**
 * @module geocoding/nominatim-throttle
 * @description Shared Nominatim (OpenStreetMap) usage-policy plumbing: one
 * app-wide ≤1 req/s sequential queue and the User-Agent header, used by both
 * reverse and forward geocoding so the whole app honors the policy from one
 * queue. Lifted here so forward + reverse never race their own throttles.
 * @license GPL-3.0-only
 */

const MIN_INTERVAL_MS = 1100; // small margin above Nominatim's 1 req/s
export const NOMINATIM_USER_AGENT =
  "Altnautica Mission Control (https://github.com/altnautica/ADOSMissionControlGCS)";

let lastFetchAt = 0;
let queue: Promise<void> = Promise.resolve();

/**
 * Wait for a turn in the global Nominatim fetch queue — ensures at least
 * MIN_INTERVAL_MS has elapsed since the previous call across the whole app.
 */
export function acquireFetchSlot(): Promise<void> {
  queue = queue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetchAt = Date.now();
  });
  return queue;
}
