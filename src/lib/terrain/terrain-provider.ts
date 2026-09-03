/**
 * @module terrain/terrain-provider
 * @description Elevation data fetcher using the Open Elevation API.
 *
 * Returns `null` for a failed lookup (offline / error / no result). That is the
 * whole contract: a genuine sea-level 0 m reading and "we have no idea" are
 * different facts, and a mission validated against a fabricated 0 m ground is
 * the worst kind of false green — every altitude looks safely clear of the sea.
 * `null` (rather than `NaN`) makes the unknown case a compile-time obligation
 * for every caller instead of a value that silently participates in arithmetic.
 *
 * Cached in an LRU (~10K entries) keyed by a quantised grid CELL INDEX, not by a
 * rounded coordinate string. The old 4-decimal (~11 m) rounding merged
 * genuinely distinct planner points into one cache entry, and the batch reader
 * then matched responses back by that same rounded coordinate — so two
 * co-rounded points could be bound each other's elevation. Batch responses are
 * now correlated by request INDEX, which is the only correlation the API
 * actually guarantees.
 *
 * @license GPL-3.0-only
 */

import type { PathElevationSample } from "./types";
import { haversineDistance } from "@/lib/telemetry-utils";

const API_URL = "https://api.open-elevation.com/api/v1/lookup";
const MAX_CACHE_SIZE = 10_000;
const BATCH_CHUNK_SIZE = 100;

/**
 * Cache grid resolution in degrees. 1e-5° is ~1.1 m — over an order of
 * magnitude finer than the ~30 m SRTM-class DEM this API serves, so two
 * distinct planner points never collapse onto one sample, while a repeated
 * lookup of the same point still hits.
 */
const CACHE_GRID_DEG = 1e-5;

// LRU cache: Map preserves insertion order, oldest entries are first
const cache = new Map<string, number>();

/** Quantised grid cell index pair — an exact key, not a lossy rounded string. */
function cacheKey(lat: number, lon: number): string {
  return `${Math.round(lat / CACHE_GRID_DEG)}:${Math.round(lon / CACHE_GRID_DEG)}`;
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
 * Returns the cached value when available, otherwise calls the API.
 * Returns `null` on failure (offline / error / no result) — never a fabricated 0.
 */
export async function getElevation(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<number | null> {
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
      return null;
    }
    const data = await response.json() as { results?: Array<{ elevation?: number }> };
    const elev = data.results?.[0]?.elevation;
    if (typeof elev !== "number" || !Number.isFinite(elev)) return null;
    cacheSet(key, elev);
    return elev;
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn("[terrain] Elevation fetch failed:", err);
    }
    return null;
  }
}

/**
 * Fetch elevations for multiple points in batch.
 * Automatically chunks requests to avoid API limits (max 100 per request).
 * Returns `null` at every index whose lookup failed; the returned array is
 * always the same length and order as `points`.
 */
export async function getElevations(
  points: Array<{ lat: number; lon: number }>,
  signal?: AbortSignal,
): Promise<Array<number | null>> {
  if (points.length === 0) return [];

  const results = new Array<number | null>(points.length).fill(null);

  // Check cache first, collect uncached indices
  const uncached: Array<{ index: number; lat: number; lon: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const cached = cacheGet(cacheKey(points[i].lat, points[i].lon));
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
        continue; // this chunk's indices stay null
      }
      const data = await response.json() as {
        results?: Array<{ elevation?: number }>;
      };
      const resultsArr = data.results;
      if (!resultsArr || resultsArr.length !== chunk.length) {
        // Partial / truncated response: the server did not answer every point,
        // so index correlation is no longer meaningful for ANY of them. Leave
        // the whole chunk unknown rather than binding a possibly-wrong value.
        console.warn(
          `[terrain] Batch returned ${resultsArr?.length ?? 0} results for ${chunk.length} points — discarding the chunk`,
        );
        continue;
      }
      // The API answers in request order and guarantees nothing else, so index
      // is the only sound correlation. Matching by rounded coordinate (the old
      // behaviour) bound the wrong elevation whenever two requested points
      // shared a rounded key.
      for (let j = 0; j < chunk.length; j++) {
        const elev = resultsArr[j]?.elevation;
        if (typeof elev !== "number" || !Number.isFinite(elev)) continue;
        results[chunk[j].index] = elev;
        cacheSet(cacheKey(chunk[j].lat, chunk[j].lon), elev);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      console.warn("[terrain] Batch fetch failed:", err);
      // this chunk's indices stay null
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
 * @returns One sample per point, `elevation: null` where the lookup failed
 */
export async function getElevationAlongPath(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  samples: number,
  signal?: AbortSignal,
): Promise<PathElevationSample[]> {
  const count = samples < 2 ? 2 : samples;

  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
    });
  }

  const elevations = await getElevations(points, signal);

  // Compute cumulative distance using simple linear interpolation
  // (for short segments, geodesic vs linear is negligible)
  let cumDist = 0;
  const result: PathElevationSample[] = [];

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
