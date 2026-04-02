/**
 * @module airspace/wind-provider
 * @description Fetches wind data at drone-relevant altitudes from Open-Meteo.
 * Free, no API key, CORS-friendly.
 * @license GPL-3.0-only
 */

export interface WindData {
  speed10m: number; // km/h
  speed120m: number; // km/h
  direction10m: number; // degrees
  gusts10m: number; // km/h
  fetchedAt: number; // timestamp ms
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FETCH_TIMEOUT_MS = 5_000;

interface CacheEntry {
  data: WindData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

const DIRECTION_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/**
 * Convert wind direction in degrees to a compass label.
 * 0/360 = N, 45 = NE, 90 = E, etc.
 */
export function windDirectionLabel(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return DIRECTION_LABELS[index];
}

/**
 * Fetch current wind data for a given lat/lon from Open-Meteo.
 * Returns cached result if available and fresh.
 * Returns null on error (never throws).
 */
export async function fetchWind(
  lat: number,
  lon: number,
): Promise<WindData | null> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLon = Math.round(lon * 100) / 100;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${roundedLat}&longitude=${roundedLon}` +
    `&hourly=wind_speed_10m,wind_speed_120m,wind_direction_10m,wind_gusts_10m` +
    `&forecast_days=1&timezone=auto`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const json = await response.json();
    const hourly = json?.hourly;

    if (
      !hourly?.time ||
      !hourly?.wind_speed_10m ||
      !hourly?.wind_speed_120m ||
      !hourly?.wind_direction_10m ||
      !hourly?.wind_gusts_10m
    ) {
      return null;
    }

    // Find the index for the current hour
    const currentHour = new Date();
    const hourIndex = findCurrentHourIndex(hourly.time, currentHour);

    const data: WindData = {
      speed10m: hourly.wind_speed_10m[hourIndex] ?? 0,
      speed120m: hourly.wind_speed_120m[hourIndex] ?? 0,
      direction10m: hourly.wind_direction_10m[hourIndex] ?? 0,
      gusts10m: hourly.wind_gusts_10m[hourIndex] ?? 0,
      fetchedAt: now,
    };

    cache.set(key, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

/**
 * Find the index in the hourly time array closest to the current hour.
 * Open-Meteo returns ISO timestamps like "2026-04-03T14:00".
 */
function findCurrentHourIndex(times: string[], now: Date): number {
  const nowMs = now.getTime();
  let bestIndex = 0;
  let bestDiff = Infinity;

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    const diff = Math.abs(t - nowMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }

  return bestIndex;
}
