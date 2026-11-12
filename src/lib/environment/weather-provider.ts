/**
 * METAR weather provider for flight records.
 *
 * Top-level flow:
 *   1. Find the nearest METAR-reporting airport within 300 km.
 *   2. Check the 30-min IDB cache keyed `altcmd:weather:{ICAO}:{bucket}`.
 *   3. On miss, fetch from aviationweather.gov (free, no API key, global)
 *      through the same-origin `/api/metar` route: the API sends no CORS
 *      header, so the browser cannot read it directly.
 *   4. Parse via {@link parseAwcMetar} and cache the result.
 *   5. Return the snapshot, or `undefined` if nothing was found or the
 *      network is down.
 *
 * Pure async — safe to fire-and-forget from the flight lifecycle's arm
 * handler. Never throws to the caller.
 *
 * @module environment/weather-provider
 * @license GPL-3.0-only
 */

import { get as idbGet, set as idbSet } from "idb-keyval";
import { findNearestMetarStation } from "./nearest-airport";
import { parseAwcMetar, type AwcMetarRow } from "./metar-parser";
import type { WeatherSnapshot } from "@/lib/types";

const CACHE_BUCKET_MS = 30 * 60 * 1000;
const CACHE_PREFIX = "altcmd:weather:";

const METAR_ROUTE = "/api/metar";

/** One console line per session when the weather lookup fails, not one per arm. */
let failureLogged = false;
function logFailureOnce(reason: string): void {
  if (failureLogged) return;
  failureLogged = true;
  console.warn(`[weather] METAR lookup unavailable: ${reason}`);
}

function cacheKey(icao: string, whenMs: number): string {
  const bucket = Math.floor(whenMs / CACHE_BUCKET_MS);
  return `${CACHE_PREFIX}${icao}:${bucket}`;
}

async function readCache(icao: string, whenMs: number): Promise<WeatherSnapshot | undefined> {
  try {
    const hit = (await idbGet(cacheKey(icao, whenMs))) as WeatherSnapshot | undefined;
    return hit;
  } catch {
    return undefined;
  }
}

async function writeCache(icao: string, whenMs: number, snapshot: WeatherSnapshot): Promise<void> {
  try {
    await idbSet(cacheKey(icao, whenMs), snapshot);
  } catch {
    // IDB write failures are non-fatal — skip silently.
  }
}

/**
 * Fetch the most recent METAR row for `icao`.
 * Returns null on any failure (network, non-200, empty body, parse error).
 */
async function fetchMetar(icao: string): Promise<AwcMetarRow | null> {
  try {
    const url = `${METAR_ROUTE}?ids=${encodeURIComponent(icao)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      logFailureOnce(`HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body) || body.length === 0) return null;
    // Prefer the most-recent row (API usually returns newest first, but be defensive).
    const rows = body as AwcMetarRow[];
    const sorted = [...rows].sort((a, b) => (b.obsTime ?? 0) - (a.obsTime ?? 0));
    return sorted[0] ?? null;
  } catch (err) {
    logFailureOnce(err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Test hook: forget that a failure was already logged. */
export function resetWeatherFailureLogForTest(): void {
  failureLogged = false;
}

/**
 * Primary entry point. Look up nearest METAR station → fetch → parse → cache.
 * Returns `undefined` when anything along the chain fails.
 *
 * Safe to call as `void getWeatherSnapshot(...)` — never throws.
 */
export async function getWeatherSnapshot(
  lat: number,
  lon: number,
  whenMs: number,
): Promise<WeatherSnapshot | undefined> {
  try {
    const nearest = await findNearestMetarStation(lat, lon, 300);
    if (!nearest) return undefined;

    // Cache hit?
    const cached = await readCache(nearest.airport.icao, whenMs);
    if (cached) return cached;

    // Fetch.
    const row = await fetchMetar(nearest.airport.icao);
    if (!row) return undefined;

    const snapshot = parseAwcMetar(row, nearest.distanceKm);
    // Ensure the friendly station name from our airports.json is used if
    // the API didn't return one.
    if (!snapshot.stationName) {
      snapshot.stationName = `${nearest.airport.name}, ${nearest.airport.countryCode}`;
    }
    await writeCache(nearest.airport.icao, whenMs, snapshot);
    return snapshot;
  } catch {
    return undefined;
  }
}
