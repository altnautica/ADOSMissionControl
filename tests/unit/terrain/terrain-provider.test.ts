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
  it('returns null on network error', async () => {
    const lat = uniqueLat();
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const elev = await getElevation(lat, 77.5);
    // null, not 0 and not NaN: "unknown" must be a value the caller cannot
    // accidentally use in arithmetic, or a mission validates against sea level.
    expect(elev).toBeNull();
  });

  it('returns null on non-OK response', async () => {
    const lat = uniqueLat();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const elev = await getElevation(lat, 77.5);
    expect(elev).toBeNull();
  });

  it('caches and returns a genuine 0m sea-level reading', async () => {
    const lat = uniqueLat();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 0 }] }),
    });
    expect(await getElevation(lat, 77.5)).toBe(0);
    // Second call must hit the cache: a real 0 is a value, not a miss.
    expect(await getElevation(lat, 77.5)).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not warn on AbortError', async () => {
    const lat = uniqueLat();
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortErr);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const elev = await getElevation(lat, 77.5);
    expect(elev).toBeNull();
    // console.warn should NOT have been called with the terrain message
    const terrainWarns = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('[terrain] Elevation fetch failed'),
    );
    expect(terrainWarns).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('does NOT collide two points 11m apart (the old 4-decimal key merged them)', async () => {
    const baseLat = uniqueLat();
    // ~0.0001 deg of latitude is ~11m. Under the old `toFixed(4)` key these two
    // shared one cache entry, so the second point silently reported the first
    // point's elevation — and the batch reader bound values by that same key.
    const lat1 = Number.parseFloat(baseLat.toFixed(4));
    const lat2 = Number.parseFloat((baseLat + 0.0001).toFixed(4));

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ elevation: 300 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ elevation: 900 }] }) });
    expect(await getElevation(lat1, 77.5)).toBe(300);
    expect(await getElevation(lat2, 77.5)).toBe(900);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('still caches a repeat lookup of the same point (quantised grid cell)', async () => {
    const lat = uniqueLat();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 42 }] }),
    });
    expect(await getElevation(lat, 77.5)).toBe(42);
    // Sub-centimetre jitter lands in the same ~1.1m grid cell.
    expect(await getElevation(lat + 0.0000001, 77.5)).toBe(42);
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

  it('fills with null on network error', async () => {
    const lat1 = uniqueLat();
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await getElevations([{ lat: lat1, lon: 77.5 }]);
    expect(result).toEqual([null]);
  });

  it('discards the whole chunk when the response has fewer results than requested', async () => {
    const lat1 = uniqueLat();
    const lat2 = uniqueLat();
    // Partial / truncated response: only one result for a two-point request.
    // Index correlation is no longer meaningful for ANY of them, so nothing is
    // bound rather than binding a possibly-wrong elevation.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 100 }] }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([null, null]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('correlates batch results by REQUEST INDEX, keeping co-rounded points distinct', async () => {
    const baseLat = uniqueLat();
    // Two points ~11m apart: identical under the old 4-decimal matcher, which
    // used `.find()` on the rounded coordinate and could bind either value to
    // either point. Index correlation is the only sound mapping the API offers.
    const lat1 = Number.parseFloat(baseLat.toFixed(4));
    const lat2 = Number.parseFloat((baseLat + 0.0001).toFixed(4));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ elevation: 111 }, { elevation: 222 }],
      }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([111, 222]);
  });

  it('preserves a genuine 0m elevation in a batch instead of dropping it', async () => {
    const lat1 = uniqueLat();
    const lat2 = uniqueLat();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ elevation: 0 }, { elevation: 12 }] }),
    });
    const result = await getElevations([
      { lat: lat1, lon: 77.5 },
      { lat: lat2, lon: 77.5 },
    ]);
    expect(result).toEqual([0, 12]);
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
