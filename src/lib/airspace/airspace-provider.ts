/**
 * @module airspace/airspace-provider
 * @description Jurisdiction dispatcher for loading airspace zones.
 * Only loads zone data for jurisdictions whose geographic region
 * overlaps the requested bounding box, avoiding wasted computation
 * and network requests for distant regions.
 * @license GPL-3.0-only
 */

import type { Jurisdiction } from "@/lib/jurisdiction";
import type { AirspaceZone, BoundingBox } from "./types";
import { getUSAirspaceZones } from "./faa-data";
import { getIndiaAirspaceZones } from "./dgca-zones";
import { getAustraliaAirspaceZones } from "./casa-zones";
import { getICAOStandardZones } from "./icao-zones";
import { fetchOpenAIPAirspaces } from "./openaip-provider";
import { fetchFaaAirspace } from "./faa-arcgis-provider";
import { getCachedZones, setCachedZones } from "./zone-cache";

/** Geographic extents for jurisdiction-specific zone providers. */
const REGION_EXTENTS: Record<string, BoundingBox> = {
  india: { south: 6, north: 36, west: 68, east: 98 },
  us:    { south: 24, north: 50, west: -125, east: -66 },
  au:    { south: -45, north: -10, west: 112, east: 154 },
};

/** Check if two bounding boxes overlap. */
function bboxOverlaps(a: BoundingBox, b: BoundingBox): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/** Country codes grouped by approximate geographic region with bbox. */
const OPENAIP_REGIONS: { bbox: BoundingBox; countries: string[] }[] = [
  // Europe
  {
    bbox: { south: 34, north: 72, west: -12, east: 45 },
    countries: ["GB", "DE", "FR", "ES", "IT", "NL", "BE", "AT", "CH", "SE",
      "NO", "DK", "FI", "PL", "CZ", "HU", "RO", "PT", "IE", "GR",
      "HR", "BG", "SK", "SI", "LT", "LV", "EE"],
  },
  // Americas
  {
    bbox: { south: -56, north: 84, west: -141, east: -34 },
    countries: ["US", "CA", "BR", "MX", "AR", "CL", "CO"],
  },
  // South & East Asia
  {
    bbox: { south: -11, north: 54, west: 68, east: 146 },
    countries: ["IN", "JP", "KR", "CN", "SG", "TH", "MY", "ID", "PH", "VN"],
  },
  // Oceania
  {
    bbox: { south: -47, north: -8, west: 112, east: 179 },
    countries: ["AU", "NZ"],
  },
  // Middle East & Africa
  {
    bbox: { south: -35, north: 42, west: -18, east: 60 },
    countries: ["AE", "SA", "IL", "ZA", "EG", "KE", "NG"],
  },
];

export async function loadAirspaceZones(
  jurisdiction: Jurisdiction | null,
  bbox: BoundingBox,
): Promise<AirspaceZone[]> {
  switch (jurisdiction) {
    case "faa":
      try {
        const arcgisZones = await fetchFaaAirspace(bbox);
        if (arcgisZones.length > 0) {
          console.log(`[airspace] FAA ArcGIS: ${arcgisZones.length} real polygons`);
          return arcgisZones;
        }
      } catch (err) {
        console.warn("[airspace] FAA ArcGIS fetch failed, falling back to circle approximations:", err);
      }
      console.log("[airspace] Using FAA circle approximations (fallback)");
      return getUSAirspaceZones(bbox);
    case "dgca":
      return getIndiaAirspaceZones(bbox);
    case "casa":
      return getAustraliaAirspaceZones(bbox);
    case "easa":
    case "caa_uk":
    case "caac":
    case "jcab":
    case "tcca":
      return []; // Zone data can be populated as available
    default:
      return [];
  }
}

/** Build a cache key from bbox coordinates. */
function bboxCacheKey(bbox: BoundingBox): string {
  return `zones-${bbox.south}-${bbox.north}-${bbox.west}-${bbox.east}`;
}

export async function loadAllAirspaceZones(
  bbox: BoundingBox,
  openAipApiKey?: string | null,
): Promise<AirspaceZone[]> {
  // Check IndexedDB cache first (instant on second visit)
  const cacheKey = bboxCacheKey(bbox);
  const cached = await getCachedZones(cacheKey);
  if (cached) {
    console.log(`[airspace] Cache hit: ${cached.length} zones from IndexedDB`);
    return cached;
  }

  const apiKey = openAipApiKey || process.env.NEXT_PUBLIC_OPENAIP_API_KEY;

  // Only load jurisdiction-specific zones that overlap the requested bbox
  const promises: Promise<AirspaceZone[]>[] = [];

  if (bboxOverlaps(bbox, REGION_EXTENTS.india)) {
    promises.push(getIndiaAirspaceZones(bbox));
  }
  if (bboxOverlaps(bbox, REGION_EXTENTS.us)) {
    promises.push(
      fetchFaaAirspace(bbox)
        .then((zones) => {
          if (zones.length > 0) {
            console.log(`[airspace] FAA ArcGIS: ${zones.length} real polygons`);
            return zones;
          }
          console.log("[airspace] FAA ArcGIS returned 0 zones, using circle fallbacks");
          return getUSAirspaceZones(bbox);
        })
        .catch((err: unknown) => {
          console.warn("[airspace] FAA ArcGIS failed, using circle fallbacks:", err);
          return getUSAirspaceZones(bbox);
        }),
    );
  }
  if (bboxOverlaps(bbox, REGION_EXTENTS.au)) {
    promises.push(getAustraliaAirspaceZones(bbox));
  }

  const results = await Promise.all(promises);
  const icao = getICAOStandardZones(bbox);
  const baseZones = [...results.flat(), ...icao];

  if (!apiKey) {
    // Cache before returning
    setCachedZones(cacheKey, baseZones).catch(() => {});
    return baseZones;
  }

  // Only fetch OpenAIP countries whose region overlaps the bbox
  try {
    const countries: string[] = [];
    for (const region of OPENAIP_REGIONS) {
      if (bboxOverlaps(bbox, region.bbox)) {
        countries.push(...region.countries);
      }
    }

    if (countries.length === 0) {
      setCachedZones(cacheKey, baseZones).catch(() => {});
      return baseZones;
    }

    const openAipZones = await fetchOpenAIPAirspaces(countries, apiKey);
    if (openAipZones.length > 0) {
      console.log(`[airspace] OpenAIP: ${openAipZones.length} polygons (${countries.length} countries) + ${baseZones.length} circle zones`);
      const allZones = [...baseZones, ...openAipZones];
      setCachedZones(cacheKey, allZones).catch(() => {});
      return allZones;
    }
  } catch (err) {
    console.warn("[airspace] OpenAIP fetch failed, using circle fallbacks:", err);
  }

  setCachedZones(cacheKey, baseZones).catch(() => {});
  return baseZones;
}
