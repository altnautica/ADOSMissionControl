/**
 * @module airportData
 * @description Embedded airport database for server-side zone generation.
 * Imports the same airport dataset used by the client-side airspace providers.
 * @license GPL-3.0-only
 */

import airportsJson from "./data/airports.json";

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

const airports: Airport[] = airportsJson as Airport[];

export function getAirports(): Airport[] {
  return airports;
}

export function getByCountry(code: string): Airport[] {
  return airports.filter((a) => a.country_code === code);
}

export function getByCountries(codes: Set<string>): Airport[] {
  return airports.filter((a) => codes.has(a.country_code));
}
