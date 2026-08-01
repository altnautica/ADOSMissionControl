import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/telemetry-utils', () => ({
  haversineDistance: (_lat1: number, _lon1: number, _lat2: number, _lon2: number) => 100,
}));

// We need to reset module state between tests because of the module-level cache
let getElevation: typeof import('@/lib/terrain/terrain-provider').getElevation;
let getElevations: typeof import('@/lib/terrain/terrain-provider').getElevations;
let getElevationAlongPath: typeof import('@/lib/terrain/terrain-provider').getElevationAlongPath;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Counter to generate unique coordinates per test (avoids cache collisions)
let coordCounter = 0;
function uniqueLat(): number {
  coordCounter++;
  return 10 + coordCounter * 0.01;
}

beforeEach(async () => {
  mockFetch.mockReset();
  // Re-import the module fresh to clear the cache
  vi.resetModules();
  const mod = await import('@/lib/terrain/terrain-provider');
  getElevation = mod.getElevation;
  getElevations = mod.getElevations;
  getElevationAlongPath = mod.getElevationAlongPath;
});

describe('getElevation', () => {
  it('returns elevation on successful fetch', async () => {
    const lat = uniqueLat();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 150 }] }),
    });
    const elev = await getElevation(lat, 77.5);
    expect(elev).toBe(150);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call (skips fetch)', async () => {
    const lat = uniqueLat();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 200 }] }),
    });
    await getElevation(lat, 77.5);
    const elev2 = await getElevation(lat, 77.5);
    expect(elev2).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns NaN on network error', async () => {
    const lat = uniqueLat();
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const elev = await getElevation(lat, 77.5);
    expect(elev).toBeNaN();
  });

  it('returns NaN on non-OK response', async () => {
    const lat = uniqueLat();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const elev = await getElevation(lat, 77.5);
    expect(elev).toBeNaN();
  });

  it('does not warn on AbortError', async () => {
    const lat = uniqueLat();
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortErr);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const elev = await getElevation(lat, 77.5);
    expect(elev).toBeNaN();
    // console.warn should NOT have been called with the terrain message
    const terrainWarns = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('[terrain] Elevation fetch failed'),
    );
    expect(terrainWarns).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('cache key rounds to 4 decimal places', async () => {
    const baseLat = uniqueLat();
    // Two coords that differ at the 5th decimal place should share a cache key
    const lat1 = parseFloat((baseLat + 0.00001).toFixed(5));
    const lat2 = parseFloat((baseLat + 0.00002).toFixed(5));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 300 }] }),
    });
    await getElevation(lat1, 77.5);
    const elev2 = await getElevation(lat2, 77.5);
    // Should use cache (same 4-decimal-place key)
    expect(elev2).toBe(300);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('getElevations', () => {
  it('returns empty array for empty input', async () => {
    const result = await getElevations([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches uncached points in batch', async () => {
    const lat1 = uniqueLat();
    const lat2 = uniqueLat();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ elevation: 100 }, { elevation: 200 }],
      }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([100, 200]);
  });

  it('uses cached values and only fetches uncached', async () => {
    const lat1 = uniqueLat();
    const lat2 = uniqueLat();

    // Pre-cache lat1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 111 }] }),
    });
    await getElevation(lat1, 77.5);

    // Batch with lat1 (cached) and lat2 (uncached)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 222 }] }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([111, 222]);
    // Only 2 total fetches: 1 for pre-cache + 1 for batch uncached
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('chunks requests by 100', async () => {
    const points = Array.from({ length: 150 }, (_, i) => ({
      lat: uniqueLat(),
      lon: 77.5,
    }));
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: Array.from({ length: 100 }, () => ({ elevation: 50 })),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: Array.from({ length: 50 }, () => ({ elevation: 60 })),
        }),
      });
    const result = await getElevations(points);
    expect(result).toHaveLength(150);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fills with NaN on network error', async () => {
    const lat1 = uniqueLat();
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await getElevations([{ lat: lat1, lon: 77.5 }]);
    expect(result.length).toBe(1); expect(result[0]).toBeNaN();
  });

  it('fills every point with NaN when the response has fewer results than requested', async () => {
    const lat1 = uniqueLat();
    const lat2 = uniqueLat();
    // Partial / truncated response: only one result for a two-point request.
    // Index-correlating results[0] against chunk[0] would silently misassign,
    // so the batch must fall back to per-point NaN for the whole chunk.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 100 }] }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([NaN, NaN]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keys results by the response location rather than request order', async () => {
    const lat1 = uniqueLat();
    const lat2 = uniqueLat();
    // The response returns elevations in the OPPOSITE order, each tagged with
    // its own location. Elevations must be assigned by coordinate, not index.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { latitude: lat2, longitude: 77.5, elevation: 222 },
          { latitude: lat1, longitude: 77.5, elevation: 111 },
        ],
      }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([111, 222]);
  });
});

describe('getElevationAlongPath', () => {
  it('returns correct number of points', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 5 }, () => ({ elevation: 100 })),
      }),
    });
    const start = { lat: uniqueLat(), lon: 77.5 };
    const end = { lat: uniqueLat(), lon: 77.6 };
    const result = await getElevationAlongPath(start, end, 5);
    expect(result).toHaveLength(5);
  });

  it('defaults to 2 samples when samples < 2', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ elevation: 100 }, { elevation: 200 }],
      }),
    });
    const start = { lat: uniqueLat(), lon: 77.5 };
    const end = { lat: uniqueLat(), lon: 77.6 };
    const result = await getElevationAlongPath(start, end, 1);
    expect(result).toHaveLength(2);
  });
});
