/**
 * @module airspace/faa-arcgis-provider
 * @description Fetches real FAA airspace boundaries from ArcGIS REST services.
 * Free, CORS-friendly, no API key required. Returns GeoJSON polygons.
 * @license GPL-3.0-only
 */

import type { AirspaceZone, AirspaceZoneType, BoundingBox } from "./types";

const BASE = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const FEET_TO_METERS = 0.3048;
const MAX_RECORDS = 2000;
const TIMEOUT_MS = 10_000;

// Session cache
const cache = new Map<string, AirspaceZone[]>();

async function queryFeatureServer(
  service: string,
  where: string,
  outFields: string,
  bbox?: BoundingBox,
): Promise<any> {
  const url = new URL(`${BASE}/${service}/FeatureServer/0/query`);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("f", "geojson");
  url.searchParams.set("resultRecordCount", String(MAX_RECORDS));
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
    if (!res.ok) throw new Error(`ArcGIS ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

const CLASS_TYPE_MAP: Record<string, AirspaceZoneType> = {
  B: "classB",
  C: "classC",
  D: "classD",
  E: "classE",
};

const SUA_TYPE_MAP: Record<string, AirspaceZoneType> = {
  R: "restricted",
  P: "prohibited",
  MOA: "moa",
  W: "warning",
  A: "alert",
};

/**
 * Fetch FAA controlled airspace (Class B, C, D, E) from ArcGIS.
 * Queries all four classes in parallel.
 */
export async function fetchFaaClassAirspace(bbox: BoundingBox): Promise<AirspaceZone[]> {
  const cacheKey = `class-airspace-${bbox.south}-${bbox.north}-${bbox.west}-${bbox.east}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const classes = ["B", "C", "D", "E"] as const;
  const outFields = "IDENT,CLASS,NAME,UPPER_VAL,LOWER_VAL,UPPER_CODE,LOWER_CODE";

  const results = await Promise.all(
    classes.map((cls) =>
      queryFeatureServer("Class_Airspace", `CLASS='${cls}'`, outFields, bbox)
        .then((geojson) => {
          if (!geojson?.features) return [] as AirspaceZone[];
          return geojson.features.map((feature: any): AirspaceZone => {
            const p = feature.properties ?? {};
            const zoneType = CLASS_TYPE_MAP[p.CLASS] ?? "classE";
            return {
              id: `faa-${(p.CLASS ?? "E").toLowerCase()}-${p.IDENT ?? feature.id ?? Math.random().toString(36).slice(2)}`,
              name: p.NAME ?? `Class ${p.CLASS} - ${p.IDENT ?? "Unknown"}`,
              type: zoneType,
              geometry: feature.geometry,
              floorAltitude: (p.LOWER_VAL ?? 0) * FEET_TO_METERS,
              ceilingAltitude: (p.UPPER_VAL ?? 18000) * FEET_TO_METERS,
              authority: "FAA",
              jurisdiction: "faa",
              metadata: {
                ident: p.IDENT ?? "",
                class: p.CLASS ?? "",
                upperCode: p.UPPER_CODE ?? "",
                lowerCode: p.LOWER_CODE ?? "",
                source: "faa-arcgis",
              },
            };
          });
        })
        .catch((err) => {
          console.warn(`[faa-arcgis] Failed to fetch Class ${cls}:`, err);
          return [] as AirspaceZone[];
        }),
    ),
  );

  const zones = results.flat();
  cache.set(cacheKey, zones);
  return zones;
}

/**
 * Fetch FAA Special Use Airspace (restricted, prohibited, MOA, warning, alert).
 */
export async function fetchFaaSua(bbox: BoundingBox): Promise<AirspaceZone[]> {
  const cacheKey = `sua-${bbox.south}-${bbox.north}-${bbox.west}-${bbox.east}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const outFields = "NAME,TYPE_CODE,UPPER_VAL,LOWER_VAL,TIMESOFUSE";

  try {
    const geojson = await queryFeatureServer(
      "Special_Use_Airspace",
      "1=1",
      outFields,
      bbox,
    );
    if (!geojson?.features) return [];

    const zones: AirspaceZone[] = geojson.features.map((feature: any): AirspaceZone => {
      const p = feature.properties ?? {};
      const typeCode = (p.TYPE_CODE ?? "").toUpperCase();
      const zoneType = SUA_TYPE_MAP[typeCode] ?? "restricted";
      return {
        id: `faa-sua-${(p.NAME ?? feature.id ?? Math.random().toString(36).slice(2)).replace(/\s+/g, "-").toLowerCase()}`,
        name: p.NAME ?? `SUA ${typeCode}`,
        type: zoneType,
        geometry: feature.geometry,
        floorAltitude: (p.LOWER_VAL ?? 0) * FEET_TO_METERS,
        ceilingAltitude: (p.UPPER_VAL ?? 18000) * FEET_TO_METERS,
        authority: "FAA",
        jurisdiction: "faa",
        metadata: {
          typeCode,
          timesOfUse: p.TIMESOFUSE ?? "",
          source: "faa-arcgis",
        },
      };
    });

    cache.set(cacheKey, zones);
    return zones;
  } catch (err) {
    console.warn("[faa-arcgis] Failed to fetch SUA:", err);
    return [];
  }
}

/**
 * Fetch all FAA airspace data (class airspace + special use airspace).
 * Main export. Falls back gracefully if either source fails.
 */
export async function fetchFaaAirspace(bbox: BoundingBox): Promise<AirspaceZone[]> {
  const [classZones, suaZones] = await Promise.all([
    fetchFaaClassAirspace(bbox),
    fetchFaaSua(bbox),
  ]);
  return [...classZones, ...suaZones];
}
