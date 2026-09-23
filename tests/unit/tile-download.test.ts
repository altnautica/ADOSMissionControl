/**
 * Offline tile download: an area past the tile limit is refused before any URL
 * is generated, and the downloader pulls URLs lazily from an iterable.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tile-cache", () => ({
  getCachedTile: vi.fn(async () => null),
  cacheTile: vi.fn(async () => {}),
  MAX_CACHE_SIZE: 500 * 1024 * 1024,
}));

import { downloadTiles } from "@/lib/tile-downloader";
import { useTileDownloadStore, MAX_DOWNLOAD_TILES } from "@/stores/tile-download-store";
import { totalTileCount, type TileProvider } from "@/lib/tile-math";

const PROVIDER: TileProvider = {
  url: "https://example.com/{z}/{x}/{y}.png", subdomains: [], maxZoom: 19, avgTileKB: 20,
  attribution: "", name: "Test", label: "TEST",
};

beforeEach(() => {
  useTileDownloadStore.setState({ isDownloading: false, result: null, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]), { status: 200 })));
});

describe("tile download", () => {
  it("refuses an area above the tile limit without fetching", async () => {
    const world = { north: 60, south: -60, east: 170, west: -170 };
    expect(totalTileCount(world, 1, 12)).toBeGreaterThan(MAX_DOWNLOAD_TILES);
    await useTileDownloadStore.getState().startDownload(world, 1, 12, PROVIDER);
    const s = useTileDownloadStore.getState();
    expect(s.isDownloading).toBe(false);
    expect(s.error).toMatch(/Too many tiles/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pulls every URL from the iterable exactly once", async () => {
    let pulled = 0;
    function* urls() {
      for (let i = 0; i < 25; i++) { pulled++; yield `https://example.com/${i}.png`; }
    }
    const result = await downloadTiles(urls(), 25, () => {}, { concurrency: 4 });
    expect(pulled).toBe(25);
    expect(fetch).toHaveBeenCalledTimes(25);
    expect(result).toMatchObject({ completed: 25, failed: 0, skipped: 0 });
  });

  it("counts a stalled tile request as failed once its deadline passes", async () => {
    // The server never answers: the request settles only when its signal aborts.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    const expired = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      queueMicrotask(() => expired.abort(new DOMException("timeout", "TimeoutError")));
      return expired.signal;
    });

    // Without a deadline the worker waits on the stalled request forever.
    const result = await downloadTiles(["https://example.com/0.png"], 1, () => {});

    expect(result).toMatchObject({ completed: 0, failed: 1, skipped: 0 });
    vi.restoreAllMocks();
  }, 1000);
});
