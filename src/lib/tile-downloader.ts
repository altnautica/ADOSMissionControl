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
 * Skips tiles already in cache. Abortable via AbortSignal.
 */
export async function downloadTiles(
  urls: string[],
  onProgress: (progress: DownloadProgress) => void,
  options?: {
    concurrency?: number;
    signal?: AbortSignal;
  },
): Promise<DownloadResult> {
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const signal = options?.signal;

  const total = urls.length;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let bytes = 0;

  // Queue of remaining URLs
  let urlIndex = 0;

  const report = () => {
    onProgress({ completed, total, bytes, skipped, failed });
  };

  async function fetchOne(): Promise<void> {
    while (urlIndex < total) {
      if (signal?.aborted) return;

      const url = urls[urlIndex++];

      try {
        // Check if already cached
        const existing = await getCachedTile(url);
        if (existing) {
          skipped++;
          completed++;
          report();
          continue;
        }

        // Fetch tile
        const response = await fetch(url, { signal });
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
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => fetchOne());
  await Promise.all(workers);

  return { completed: completed - failed - skipped, failed, skipped, totalBytes: bytes };
}
