/**
 * Find the nearest ICAO-reporting airport to a given lat/lon.
 *
 * Reads the bundled world airports dataset lazily (dynamic import via a
 * fetch of `public/airports.json` equivalent — here we import the JSON
 * module, which Next.js will code-split away from the main bundle). Filters
 * to 4-letter ICAO codes of medium/large airport type — the set that
 * reliably has METAR reports — and does a haversine-nearest search within
 * a user-supplied radius.
 *
 * @module environment/nearest-airport
 * @license GPL-3.0-only
 */

export interface AirportSummary {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  countryCode: string;
  municipality: string;
}

interface RawAirport {
  icao: string;
  iata: string;
  name: string;
  lat: number;
  lon: number;
  elevation_m: number;
  type: string;
  country_code: string;
  municipality: string;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 4-letter ICAO pattern excluding numeric/hyphenated placeholder codes. */
const ICAO_REGEX = /^[A-Z]{4}$/;

/**
 * In-memory cache of the METAR-candidate airport subset. Filled on first
 * call and reused. The source JSON is ~933 KB but we keep only the fields
 * we need, which collapses to ~80 KB in memory.
 */
let _candidates: AirportSummary[] | null = null;
let _loadingPromise: Promise<AirportSummary[]> | null = null;

async function loadCandidates(): Promise<AirportSummary[]> {
  if (_candidates) return _candidates;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    // Dynamic import keeps the 933 KB JSON out of the main chunk.
    const mod = await import("@/data/airports.json");
    const list: RawAirport[] = (mod.default ?? mod) as RawAirport[];
    const candidates = list
      .filter(
        (a) =>
          ICAO_REGEX.test(a.icao) &&
          (a.type === "medium_airport" || a.type === "large_airport"),
      )
      .map((a) => ({
        icao: a.icao,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        countryCode: a.country_code,
        municipality: a.municipality,
      }));
    _candidates = candidates;
    _loadingPromise = null;
    return candidates;
  })();

  return _loadingPromise;
}

export interface NearestAirportResult {
  airport: AirportSummary;
  distanceKm: number;
}

/**
 * Find the nearest METAR-reporting airport within `maxKm` of the given
 * position. Returns `null` if none found within range.
 */
export async function findNearestMetarStation(
  lat: number,
  lon: number,
  maxKm: number = 300,
): Promise<NearestAirportResult | null> {
  const candidates = await loadCandidates();
  let best: AirportSummary | null = null;
  let bestDist = Infinity;
  for (const a of candidates) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  if (!best || bestDist > maxKm) return null;
  return { airport: best, distanceKm: Math.round(bestDist * 10) / 10 };
}
