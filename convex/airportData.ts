/**
 * @module airportData
 * @description Fetches airport database from GitHub at runtime for server-side
 * zone generation. Cached in memory after first fetch.
 * @license GPL-3.0-only
 */

const AIRPORTS_URL =
  "https://raw.githubusercontent.com/altnautica/ADOSMissionControl/main/src/data/airports.json";

export interface Airport {
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

let cached: Airport[] | null = null;

export async function getAirports(): Promise<Airport[]> {
  if (cached) return cached;
  const res = await fetch(AIRPORTS_URL);
  if (!res.ok) throw new Error(`Failed to fetch airports: ${res.status}`);
  cached = (await res.json()) as Airport[];
  return cached;
}

export async function getByCountry(code: string): Promise<Airport[]> {
  const airports = await getAirports();
  return airports.filter((a) => a.country_code === code);
}
