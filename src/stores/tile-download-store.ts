/**
 * Tile download state management.
 *
 * @module tile-download-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { downloadTiles, type DownloadProgress, type DownloadResult } from "@/lib/tile-downloader";
import { generateTileUrls, type LatLngBounds, type TileProvider } from "@/lib/tile-math";

interface TileDownloadState {
  isDownloading: boolean;
  progress: DownloadProgress;
  result: DownloadResult | null;
  error: string | null;

  startDownload: (
    bounds: LatLngBounds,
    zMin: number,
    zMax: number,
    provider: TileProvider,
  ) => Promise<void>;
  cancelDownload: () => void;
  clearResult: () => void;
}

let abortController: AbortController | null = null;

export const useTileDownloadStore = create<TileDownloadState>((set, get) => ({
  isDownloading: false,
  progress: { completed: 0, total: 0, bytes: 0, skipped: 0, failed: 0 },
  result: null,
  error: null,

  startDownload: async (bounds, zMin, zMax, provider) => {
    if (get().isDownloading) return;

    // Collect all URLs into array (generator → array for total count)
    const urls: string[] = [];
    for (const url of generateTileUrls(bounds, zMin, zMax, provider)) {
      urls.push(url);
    }

    abortController = new AbortController();
    set({
      isDownloading: true,
      progress: { completed: 0, total: urls.length, bytes: 0, skipped: 0, failed: 0 },
      result: null,
      error: null,
    });

    try {
      const result = await downloadTiles(
        urls,
        (progress) => set({ progress }),
        { signal: abortController.signal },
      );

      set({ isDownloading: false, result });
    } catch (err) {
      if (abortController.signal.aborted) {
        set({ isDownloading: false, error: "Download cancelled" });
      } else {
        set({ isDownloading: false, error: "Download failed" });
      }
    } finally {
      abortController = null;
    }
  },

  cancelDownload: () => {
    abortController?.abort();
  },

  clearResult: () => set({ result: null, error: null }),
}));
