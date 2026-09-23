/**
 * Reverse geocoding via Nominatim (OpenStreetMap).
 *
 * Nominatim usage policy requires ≤1 request per second, a meaningful
 * User-Agent header, and aggressive caching. We do all three:
 *
 *   1. Memory LRU of recently-seen (lat.toFixed(3), lon.toFixed(3)) keys.
 *   2. IndexedDB persistent cache (infinite TTL — place names don't change).
 *   3. App-wide 1-req/s throttler — sequential queue, no parallel fetches.
 *
 * Pure async, never throws, never blocks the caller. Returns undefined on
 * any failure (timeout, HTTP error, parse error, offline).
 *
 * @module geocoding/reverse
 * @license GPL-3.0-only
 */

import { get as idbGet, set as idbSet } from "idb-keyval";
import { acquireFetchSlot, NOMINATIM_USER_AGENT } from "./nominatim-throttle";

// ── Result shape ─────────────────────────────────────────────

export interface ReverseGeocodeResult {
  /** Comma-joined friendly name: "Bangalore, Karnataka, India". */
  placeName: string;
  /** ISO 3166-1 alpha-2 (e.g. "IN", "US"). */
  country?: string;
  /** State / province / region. */
  region?: string;
  /** City / town / village. */
  locality?: string;
}

// ── Memory LRU ───────────────────────────────────────────────

const LRU_MAX = 500;
const memoryCache = new Map<string, ReverseGeocodeResult>();

function memGet(key: string): ReverseGeocodeResult | undefined {
  const hit = memoryCache.get(key);
  if (hit) {
    // Move to end (most-recently-used).
    memoryCache.delete(key);
    memoryCache.set(key, hit);
  }
  return hit;
}

function memSet(key: string, value: ReverseGeocodeResult): void {
  if (memoryCache.has(key)) memoryCache.delete(key);
  memoryCache.set(key, value);
  if (memoryCache.size > LRU_MAX) {
    const first = memoryCache.keys().next().value;
    if (first !== undefined) memoryCache.delete(first);
  }
}

// ── IDB cache ────────────────────────────────────────────────

const IDB_PREFIX = "altcmd:geocode:";

function cacheKey(lat: number, lon: number): string {
  // ~110 m grid — small enough for flight sites to share a key.
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

async function idbGetCached(key: string): Promise<ReverseGeocodeResult | undefined> {
  try {
    return (await idbGet(`${IDB_PREFIX}${key}`)) as ReverseGeocodeResult | undefined;
  } catch {
    return undefined;
  }
}

async function idbSetCached(key: string, value: ReverseGeocodeResult): Promise<void> {
  try {
    await idbSet(`${IDB_PREFIX}${key}`, value);
  } catch {
    // IDB write failures are non-fatal.
  }
}

// ── Nominatim response shape (subset) ────────────────────────

interface NominatimResponse {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    suburb?: string;
    county?: string;
    state?: string;
    region?: string;
    country?: string;
    country_code?: string;
  };
}

function buildResult(r: NominatimResponse): ReverseGeocodeResult {
  const a = r.address ?? {};
  const locality =
    a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county;
  const region = a.state ?? a.region;
  const country = a.country_code?.toUpperCase();
  const countryName = a.country;

  const parts: string[] = [];
  if (locality) parts.push(locality);
  if (region && region !== locality) parts.push(region);
  if (countryName) parts.push(countryName);
  const placeName = parts.join(", ") || r.display_name || "Unknown";

  return { placeName, country, region, locality };
}

// ── Fetch ────────────────────────────────────────────────────

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

async function fetchNominatim(lat: number, lon: number): Promise<ReverseGeocodeResult | undefined> {
  try {
    await acquireFetchSlot();

    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim asks for a meaningful User-Agent. Browsers may strip
        // this, which is fine — Nominatim will still accept the request.
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return undefined;
    const body = (await res.json()) as NominatimResponse;
    if (!body || typeof body !== "object") return undefined;
    return buildResult(body);
  } catch {
    return undefined;
  }
}

// ── Public entry ─────────────────────────────────────────────

/**
 * Reverse-geocode a lat/lon into a friendly place name. Layered cache:
 * memory → IDB → network. Returns undefined on any failure.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult | undefined> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  const key = cacheKey(lat, lon);

  // Memory layer.
  const mem = memGet(key);
  if (mem) return mem;

  // IDB layer.
  const disk = await idbGetCached(key);
  if (disk) {
    memSet(key, disk);
    return disk;
  }

  // Network layer (throttled).
  const result = await fetchNominatim(lat, lon);
  if (result) {
    memSet(key, result);
    void idbSetCached(key, result);
  }
  return result;
}
