/**
 * @module terrain/terrain-provider
 * @description Elevation data fetcher using the Open Elevation API.
 * Includes an LRU cache (~10K entries) and batch API support.
 * Returns NaN for a failed lookup (offline / error / no result) so a genuine
 * sea-level 0m reading is never confused with "data unavailable". Callers must
 * check Number.isFinite() before trusting a value.
 * @license GPL-3.0-only
 */

import type { TerrainPoint } from "./types";

const API_URL = "https://api.open-elevation.com/api/v1/lookup";
const MAX_CACHE_SIZE = 10_000;
const BATCH_CHUNK_SIZE = 100;

// LRU cache: Map preserves insertion order, oldest entries are first
const cache = new Map<string, number>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function cacheSet(key: string, value: number): void {
  // If key already exists, delete to re-insert at end (most recent)
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  // Evict oldest entries if over capacity
  if (cache.size > MAX_CACHE_SIZE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
}

function cacheGet(key: string): number | undefined {
  const val = cache.get(key);
  if (val !== undefined) {
    // Move to end (most recent)
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

/**
 * Fetch elevation for a single point.
 * Returns cached value if available, otherwise calls API.
 * Returns NaN on failure (offline / error / no result) — never a fabricated 0.
 */
export async function getElevation(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<number> {
  const key = cacheKey(lat, lon);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: [{ latitude: lat, longitude: lon }] }),
      signal,
    });
    if (!response.ok) {
      console.warn(`[terrain] API returned ${response.status}`);
      return NaN;
    }
    const data = await response.json() as { results: Array<{ elevation: number }> };
    const elev = data.results?.[0]?.elevation ?? NaN;
    if (Number.isFinite(elev)) cacheSet(key, elev);
    return elev;
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn("[terrain] Elevation fetch failed:", err);
    }
    return NaN;
  }
}

/**
 * Fetch elevations for multiple points in batch.
 * Automatically chunks requests to avoid API limits (max 100 per request).
 * Returns NaN for any failed lookup (offline / error / no result).
 */
export async function getElevations(
  points: Array<{ lat: number; lon: number }>,
  signal?: AbortSignal,
): Promise<number[]> {
  if (points.length === 0) return [];

  const results = new Array<number>(points.length);

  // Check cache first, collect uncached indices
  const uncached: Array<{ index: number; lat: number; lon: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const key = cacheKey(points[i].lat, points[i].lon);
    const cached = cacheGet(key);
    if (cached !== undefined) {
      results[i] = cached;
    } else {
      uncached.push({ index: i, lat: points[i].lat, lon: points[i].lon });
    }
  }

  // Fetch uncached in chunks
  for (let start = 0; start < uncached.length; start += BATCH_CHUNK_SIZE) {
    const chunk = uncached.slice(start, start + BATCH_CHUNK_SIZE);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lon })),
        }),
        signal,
      });
      if (!response.ok) {
        console.warn(`[terrain] Batch API returned ${response.status}`);
        for (const item of chunk) results[item.index] = NaN;
        continue;
      }
      const data = await response.json() as {
        results: Array<{ latitude: number; longitude: number; elevation: number }>;
      };
      const resultsArr = data.results;
      if (!resultsArr || resultsArr.length !== chunk.length) {
        // Partial / truncated response: the server did not answer every point,
        // so index-correlating `results[j]` against `chunk[j]` would silently
        // misalign elevations. Fall back to per-point NaN, never a fabricated 0.
        for (const item of chunk) results[item.index] = NaN;
        continue;
      }
      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const resp = resultsArr[j];
        let elev = NaN;
        if (resp && Number.isFinite(resp.latitude) && Number.isFinite(resp.longitude)) {
          // Key by the response's own location rather than assuming
          // request-order preservation, matching the cache's 4-decimal rounding.
          const match = resultsArr.find(
            (r) =>
              Number.isFinite(r.latitude) &&
              Number.isFinite(r.longitude) &&
              r.latitude.toFixed(4) === item.lat.toFixed(4) &&
              r.longitude.toFixed(4) === item.lon.toFixed(4),
          );
          elev = match?.elevation ?? NaN;
        } else {
          // No location in the response: fall back to request-order correlation.
          elev = resp?.elevation ?? NaN;
        }
        results[item.index] = elev;
        if (Number.isFinite(elev)) cacheSet(cacheKey(item.lat, item.lon), elev);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      console.warn("[terrain] Batch fetch failed:", err);
      for (const item of chunk) results[item.index] = NaN;
    }
  }

  return results;
}

/**
 * Get elevation samples along a straight-line path between two points.
 *
 * @param start Start position
 * @param end   End position
 * @param samples Number of sample points (including start and end)
 * @param signal Optional AbortSignal for cancellation
 * @returns Array of TerrainPoints with distance from start and elevation
 */
export async function getElevationAlongPath(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  samples: number,
  signal?: AbortSignal,
): Promise<TerrainPoint[]> {
  if (samples < 2) samples = 2;

  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    points.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
    });
  }

  const elevations = await getElevations(points, signal);

  // Compute cumulative distance using simple linear interpolation
  // (for short segments, geodesic vs linear is negligible)
  const { haversineDistance } = await import("@/lib/telemetry-utils");
  let cumDist = 0;
  const result: TerrainPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      cumDist += haversineDistance(
        points[i - 1].lat, points[i - 1].lon,
        points[i].lat, points[i].lon,
      );
    }
    result.push({
      lat: points[i].lat,
      lon: points[i].lon,
      distance: cumDist,
      elevation: elevations[i],
    });
  }

  return result;
}
