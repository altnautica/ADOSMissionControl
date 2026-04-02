/**
 * @module airspace/icao-zones
 * @description Generic ICAO standard airspace zone generator for airports
 * NOT in India (IN), USA (US), or Australia (AU). Generates Class B zones
 * for large airports and Class D zones for medium airports using ICAO defaults.
 * Filters airports by bounding box BEFORE generating circle polygons to avoid
 * computing geometry for thousands of airports that won't be displayed.
 * @license GPL-3.0-only
 */

import type { Jurisdiction } from "@/lib/jurisdiction";
import type { AirspaceZone, BoundingBox } from "./types";
import { circlePolygon, inBbox } from "./geo-utils";
import { getAirportsSync } from "./airport-database";

const NM_TO_KM = 1.852;
const EXCLUDED_COUNTRIES = new Set(["IN", "US", "AU"]);

/** Maps ISO 3166-1 alpha-2 country codes to their aviation jurisdiction. */
const COUNTRY_TO_JURISDICTION: Record<string, Jurisdiction> = {
  // EASA members (EU + EEA + Switzerland)
  DE: "easa", FR: "easa", ES: "easa", IT: "easa", NL: "easa", BE: "easa",
  PT: "easa", AT: "easa", SE: "easa", FI: "easa", NO: "easa", DK: "easa",
  PL: "easa", CZ: "easa", HU: "easa", RO: "easa", BG: "easa", HR: "easa",
  GR: "easa", IE: "easa", CH: "easa", LU: "easa", SK: "easa", SI: "easa",
  LT: "easa", LV: "easa", EE: "easa", CY: "easa", MT: "easa", IS: "easa",
  LI: "easa",
  // UK
  GB: "caa_uk",
  // China
  CN: "caac", HK: "caac", MO: "caac",
  // Japan
  JP: "jcab",
  // Canada
  CA: "tcca",
};

/**
 * Get ICAO standard airspace zones for airports outside India, US, and Australia.
 * Large airports get Class B (15 NM radius, 0-10,000 ft).
 * Medium airports get Class D (5 NM radius, 0-2,500 ft).
 * Airports are filtered by bounding box BEFORE generating circle polygons.
 */
export function getICAOStandardZones(bbox: BoundingBox): AirspaceZone[] {
  const airports = getAirportsSync();
  const zones: AirspaceZone[] = [];

  for (const airport of airports) {
    if (EXCLUDED_COUNTRIES.has(airport.country)) continue;
    if (!inBbox(airport.lat, airport.lon, bbox)) continue;

    const jurisdiction = COUNTRY_TO_JURISDICTION[airport.country];

    if (airport.type === "large_airport") {
      zones.push({
        id: `icao-classb-${airport.icao}`,
        name: `${airport.name} Class B`,
        type: "classB",
        geometry: circlePolygon(airport.lat, airport.lon, 15 * NM_TO_KM),
        circle: { lat: airport.lat, lon: airport.lon, radiusM: 15 * 1852 },
        floorAltitude: 0,
        ceilingAltitude: 3048, // 10,000 ft
        authority: "ICAO",
        ...(jurisdiction && { jurisdiction }),
        metadata: { icao: airport.icao, generated: "icao-standard" },
      });
    } else if (airport.type === "medium_airport") {
      zones.push({
        id: `icao-classd-${airport.icao}`,
        name: `${airport.name} Class D`,
        type: "classD",
        geometry: circlePolygon(airport.lat, airport.lon, 5 * NM_TO_KM),
        circle: { lat: airport.lat, lon: airport.lon, radiusM: 5 * 1852 },
        floorAltitude: 0,
        ceilingAltitude: 762, // 2,500 ft
        authority: "ICAO",
        ...(jurisdiction && { jurisdiction }),
        metadata: { icao: airport.icao, generated: "icao-standard" },
      });
    }
  }

  return zones;
}
