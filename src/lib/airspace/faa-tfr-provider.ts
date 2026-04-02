/**
 * @module airspace/faa-tfr-provider
 * @description Fetches real FAA TFRs from ArcGIS REST services.
 * @license GPL-3.0-only
 */

import type { TemporaryRestriction, BoundingBox } from "./types";

const BASE = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const FEET_TO_METERS = 0.3048;
const TIMEOUT_MS = 10_000;

// Session cache with 10-minute TTL (TFRs are time-sensitive)
const TFR_CACHE_TTL = 10 * 60 * 1000;
let cachedTfrs: { data: TemporaryRestriction[]; timestamp: number } | null = null;

/**
 * Fetch FAA Temporary Flight Restrictions from ArcGIS.
 */
export async function fetchFaaTfrs(bbox?: BoundingBox): Promise<TemporaryRestriction[]> {
  if (cachedTfrs && Date.now() - cachedTfrs.timestamp < TFR_CACHE_TTL) {
    return cachedTfrs.data;
  }

  const url = new URL(
    `${BASE}/National_Defense_Airspace_TFR_Areas/FeatureServer/0/query`,
  );
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("f", "geojson");
  url.searchParams.set("resultRecordCount", "500");
  if (bbox) {
    url.searchParams.set("geometry", `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`ArcGIS TFR ${res.status}`);
    const geojson = await res.json();
    if (!geojson?.features) return [];

    const tfrs: TemporaryRestriction[] = geojson.features.map(
      (feature: any): TemporaryRestriction => {
        const p = feature.properties ?? {};

        // ArcGIS timestamps may be epoch ms or ISO strings
        const parseTime = (val: any): string => {
          if (!val) return new Date().toISOString();
          if (typeof val === "number") return new Date(val).toISOString();
          return String(val);
        };

        const name = p.NAME ?? p.NOTAM ?? p.IDENT ?? `TFR-${feature.id ?? Math.random().toString(36).slice(2)}`;

        return {
          id: `faa-tfr-${name.replace(/\s+/g, "-").toLowerCase()}`,
          name,
          type: "tfr",
          geometry: feature.geometry,
          floorAltitude: (p.LOWER_VAL ?? p.FLOOR ?? 0) * FEET_TO_METERS,
          ceilingAltitude: (p.UPPER_VAL ?? p.CEILING ?? 18000) * FEET_TO_METERS,
          validFrom: parseTime(p.EFFECTIVE ?? p.DATE_EFF ?? p.START_DATE),
          validTo: parseTime(p.EXPIRE ?? p.DATE_EXP ?? p.END_DATE),
          authority: "FAA",
          description: p.REASON ?? p.DESCRIPTION ?? p.TYPE ?? "Temporary Flight Restriction",
        };
      },
    );

    cachedTfrs = { data: tfrs, timestamp: Date.now() };
    console.log(`[faa-tfr] Loaded ${tfrs.length} TFRs from ArcGIS`);
    return tfrs;
  } catch (err) {
    console.warn("[faa-tfr] Failed to fetch TFRs:", err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
