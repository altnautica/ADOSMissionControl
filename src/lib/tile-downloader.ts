/**
 * Concurrent tile download engine.
 *
 * Downloads map tiles with configurable concurrency (default 6),
 * batched IndexedDB writes, and abort support. Skips already-cached tiles.
 *
 * @module tile-downloader
 * @license GPL-3.0-only
 */

import { getCachedTile, cacheTile } from "./tile-cache";

const DEFAULT_CONCURRENCY = 6;
/** Per-tile deadline covering the request and the body read. */
const TILE_FETCH_TIMEOUT_MS = 15_000;

export interface DownloadProgress {
  completed: number;
  total: number;
  bytes: number;
  skipped: number;
  failed: number;
}

export interface DownloadResult {
  completed: number;
  failed: number;
  skipped: number;
  totalBytes: number;
}

/**
 * Download tiles with concurrency control and progress reporting.
 * Skips tiles already in cache. Abortable via AbortSignal. URLs are pulled
 * from the iterable one at a time, so a large area is never materialised as
 * an array; `total` is the count the iterable yields, for progress.
 */
export async function downloadTiles(
  urls: Iterable<string>,
  total: number,
  onProgress: (progress: DownloadProgress) => void,
  options?: {
    concurrency?: number;
    signal?: AbortSignal;
  },
): Promise<DownloadResult> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const signal = options?.signal;

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;

  // Shared queue of remaining URLs; next() is synchronous, so workers never
  // take the same URL.
  const queue = urls[Symbol.iterator]();

  const report = () => {
    onProgress({ completed, total, bytes, skipped, failed });
  };

  async function fetchOne(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;

      const next = queue.next();
      if (next.done) return;
      const url = next.value;

      try {
        // Check if already cached
        const existing = await getCachedTile(url);
        if (existing) {
          skipped++;
          completed++;
          report();
          continue;
        }

        // Fetch tile. A stalled server connection counts as a failed tile
        // after the timeout instead of holding this worker forever.
        const timeout = AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS);
        const response = await fetch(url, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) {
          failed++;
          completed++;
          report();
          continue;
        }

        const blob = await response.blob();
        await cacheTile(url, blob);

        bytes += blob.size;
        completed++;
        report();
      } catch (err) {
        if (signal?.aborted) return;
        failed++;
        completed++;
        report();
      }
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, () => fetchOne());
  await Promise.all(workers);

  return { completed: completed - failed - skipped, failed, skipped, totalBytes: bytes };
}
