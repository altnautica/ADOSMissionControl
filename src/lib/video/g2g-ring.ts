/**
 * @module video/g2g-ring
 * @description The rolling glass-to-glass window behind the video store's
 * `latency.trueG2GMs`, and the rate limit on publishing it.
 *
 * Samples arrive once per presented frame (30-60 Hz). The ring lives outside
 * the store, and its mean + std-dev is handed to `publish` at most every
 * {@link G2G_PUBLISH_INTERVAL_MS}: a store write per frame re-rendered every
 * `latency` subscriber (the HUD, the radar, the plugin overlay host) at the
 * frame rate. Same floor as the latency-budget notifier. A trailing timer
 * publishes the last sample of a burst so the readout never sticks on an
 * older value.
 *
 * @license GPL-3.0-only
 */

const G2G_RING_SIZE = 30;
export const G2G_PUBLISH_INTERVAL_MS = 250;

export interface G2GStats {
  ewma: number;
  stddev: number;
  at: number;
}

const ring: number[] = [];
let lastPublishAt = Number.NEGATIVE_INFINITY;
let trailing: ReturnType<typeof setTimeout> | undefined;

function stats(): Omit<G2GStats, "at"> {
  const mean = ring.reduce((a, b) => a + b, 0) / ring.length;
  const variance = ring.reduce((acc, v) => acc + (v - mean) ** 2, 0) / ring.length;
  return { ewma: mean, stddev: Math.sqrt(variance) };
}

/** Add one sample; `publish` runs now or on the trailing edge of the interval. */
export function recordG2G(ms: number, publish: (s: G2GStats) => void): void {
  ring.push(ms);
  if (ring.length > G2G_RING_SIZE) ring.shift();
  const run = () => {
    trailing = undefined;
    if (ring.length === 0) return;
    lastPublishAt = Date.now();
    publish({ ...stats(), at: lastPublishAt });
  };
  const wait = lastPublishAt + G2G_PUBLISH_INTERVAL_MS - Date.now();
  if (wait <= 0) run();
  else if (trailing === undefined) trailing = setTimeout(run, wait);
}

/** Empty the window and drop any pending publish. */
export function clearG2G(): void {
  ring.length = 0;
  lastPublishAt = Number.NEGATIVE_INFINITY;
  clearTimeout(trailing);
  trailing = undefined;
}
