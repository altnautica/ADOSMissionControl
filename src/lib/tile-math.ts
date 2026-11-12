/**
 * Slippy map tile coordinate math.
 *
 * Converts geographic coordinates to XYZ tile indices,
 * counts tiles in bounding boxes, and generates tile URLs
 * for bulk download.
 *
 * @module tile-math
 * @license GPL-3.0-only
 */

import type { MapTileSource } from "@/stores/settings-store-types";

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TileProvider {
  /** `raster`: image tiles drawn by Leaflet. `vector`: MVT drawn by MapLibre. */
  kind: "raster" | "vector";
  url: string;
  subdomains: string[];
  maxZoom: number;
  avgTileKB: number;
  /** Leaflet attribution HTML. Empty for a self-hosted source. */
  attribution: string;
  /** Long-form name for menus (the offline download panel's provider select). */
  name: string;
  /** Short uppercase label for the segmented basemap control. */
  label: string;
  /** Vector style flavor; set for `vector` providers only. */
  flavor?: "dark" | "light";
}

/** Every basemap id with a fixed catalog entry (not operator- or agent-supplied). */
export type BuiltInTileSource = Exclude<MapTileSource, "custom" | "field-pack">;

/** Vector tiles of the self-hosted basemap. */
export const VECTOR_BASEMAP_URL = "https://tiles.altnautica.com/planet/{z}/{x}/{y}.mvt";
const VECTOR_BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; <a href="https://protomaps.com">Protomaps</a>';

export const TILE_PROVIDERS: Record<BuiltInTileSource, TileProvider> = {
  // Dark Gray Canvas needs no API key; the previous dark source started
  // answering keyless requests with an "API key required" placeholder tile.
  dark: {
    kind: "raster",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    maxZoom: 16,
    avgTileKB: 10,
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    name: "Esri Dark Gray",
    label: "DARK",
  },
  osm: {
    kind: "raster",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 19,
    avgTileKB: 25,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    name: "OpenStreetMap",
    label: "OSM",
  },
  satellite: {
    kind: "raster",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    maxZoom: 18,
    avgTileKB: 40,
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    name: "Esri Satellite",
    label: "SAT",
  },
  terrain: {
    kind: "raster",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 17,
    avgTileKB: 20,
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    name: "OpenTopoMap",
    label: "TOPO",
  },
  // Vector tiles stop at z15; MapLibre overzooms them past that, so the
  // on-screen map still zooms to street level.
  "streets-dark": {
    kind: "vector",
    url: VECTOR_BASEMAP_URL,
    subdomains: [],
    maxZoom: 15,
    avgTileKB: 30,
    attribution: VECTOR_BASEMAP_ATTRIBUTION,
    name: "Streets dark (vector)",
    label: "STREETS",
    flavor: "dark",
  },
  "streets-light": {
    kind: "vector",
    url: VECTOR_BASEMAP_URL,
    subdomains: [],
    maxZoom: 15,
    avgTileKB: 30,
    attribution: VECTOR_BASEMAP_ATTRIBUTION,
    name: "Streets light (vector)",
    label: "LIGHT",
    flavor: "light",
  },
};

/** Latitude limit of the Web-Mercator tile grid. */
const MAX_MERCATOR_LAT = 85.0511287798066;

/** Convert longitude to tile X index at zoom z, clamped to the grid. */
export function lonToTileX(lon: number, z: number): number {
  const n = Math.pow(2, z);
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

/** Convert latitude to tile Y index at zoom z, clamped to the Web-Mercator grid. */
export function latToTileY(lat: number, z: number): number {
  const n = Math.pow(2, z);
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const latRad = (clamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return Math.min(n - 1, Math.max(0, y));
}

/**
 * Tile column ranges `[xMin, xMax]` covering a box at zoom z. A map panned
 * across the antimeridian reports longitudes past ±180; the box is wrapped
 * back onto the world and split in two where it crosses 180°, so every
 * column is a real tile index (the indices Leaflet requests for a wrapped
 * world).
 */
function tileXRanges(bounds: LatLngBounds, z: number): [number, number][] {
  const n = Math.pow(2, z);
  const span = bounds.east - bounds.west;
  if (span >= 360) return [[0, n - 1]];
  if (span < 0) return [];
  const west = ((((bounds.west + 180) % 360) + 360) % 360) - 180;
  const east = west + span;
  if (east <= 180) return [[lonToTileX(west, z), lonToTileX(east, z)]];
  const wrapped: [number, number][] = [[lonToTileX(west, z), n - 1], [0, lonToTileX(east - 360, z)]];
  // Near-world spans can make the two pieces meet; merge rather than overlap.
  return wrapped[1][1] >= wrapped[0][0] ? [[0, n - 1]] : wrapped;
}

/** Count tiles in a bounding box at a specific zoom level. */
export function tileCountAtZoom(bounds: LatLngBounds, z: number): number {
  const rows = latToTileY(bounds.south, z) - latToTileY(bounds.north, z) + 1;
  if (rows <= 0) return 0;
  let columns = 0;
  for (const [xMin, xMax] of tileXRanges(bounds, z)) columns += xMax - xMin + 1;
  return columns * rows;
}

/** Count total tiles across a zoom range. */
export function totalTileCount(bounds: LatLngBounds, zMin: number, zMax: number): number {
  let total = 0;
  for (let z = zMin; z <= zMax; z++) {
    total += tileCountAtZoom(bounds, z);
  }
  return total;
}

/** Estimate total download size in bytes. */
export function estimateDownloadSize(
  bounds: LatLngBounds,
  zMin: number,
  zMax: number,
  avgTileKB: number,
): number {
  return totalTileCount(bounds, zMin, zMax) * avgTileKB * 1024;
}

/**
 * Detect a retina / HiDPI display. Mirrors Leaflet's `L.Browser.retina` so the
 * offline downloader stores the same `@2x` tile variant the on-screen layer
 * requests. Without this, on a HiDPI screen the write URL (no `@2x`) and the
 * read URL (`@2x`) never match and every cache lookup misses.
 */
export function isRetinaDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (window.devicePixelRatio || 1) > 1;
}

/**
 * Subdomain list for a known provider URL template, matching {@link TILE_PROVIDERS}.
 * Falls back to Leaflet's default `abc` scheme for an unrecognised template so the
 * read side stays compatible with any custom URL.
 */
export function subdomainsForUrl(urlTemplate: string): string[] {
  for (const provider of Object.values(TILE_PROVIDERS)) {
    if (provider.url === urlTemplate) return provider.subdomains;
  }
  return ["a", "b", "c"];
}

/** Basemap ids in picker order, including the operator-supplied source. */
export const BASEMAP_ORDER: MapTileSource[] = [
  "dark",
  "osm",
  "satellite",
  "terrain",
  "streets-dark",
  "streets-light",
  "custom",
];
export const CUSTOM_BASEMAP_LABEL = "CUSTOM";
export const CUSTOM_BASEMAP_NAME = "Custom (self-hosted)";
export const FIELD_PACK_BASEMAP_LABEL = "FIELD";
export const FIELD_PACK_BASEMAP_NAME = "Field pack (ground agent)";
/** Size estimate for a custom source, between OSM's 25 and Esri's 40. */
export const CUSTOM_TILE_AVG_KB = 25;
export const DEFAULT_CUSTOM_TILE_MAX_ZOOM = 19;
export const MIN_CUSTOM_TILE_MAX_ZOOM = 1;
export const MAX_CUSTOM_TILE_MAX_ZOOM = 24;

/** Short uppercase label for the segmented basemap control. */
export function basemapLabel(source: MapTileSource): string {
  if (source === "custom") return CUSTOM_BASEMAP_LABEL;
  if (source === "field-pack") return FIELD_PACK_BASEMAP_LABEL;
  return TILE_PROVIDERS[source].label;
}

/** Long-form menu name. */
export function basemapName(source: MapTileSource): string {
  if (source === "custom") return CUSTOM_BASEMAP_NAME;
  if (source === "field-pack") return FIELD_PACK_BASEMAP_NAME;
  return TILE_PROVIDERS[source].name;
}

/** Clamp an operator-entered max zoom into Leaflet's usable range. */
export function clampTileZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CUSTOM_TILE_MAX_ZOOM;
  return Math.min(MAX_CUSTOM_TILE_MAX_ZOOM, Math.max(MIN_CUSTOM_TILE_MAX_ZOOM, Math.round(zoom)));
}

export interface CustomTileSource {
  url: string;
  maxZoom: number;
  attribution: string;
}

/**
 * Validate an operator-entered tile URL template. Returns null when usable,
 * else a message for the UI.
 *
 * Validates the RAW string, never a parsed `URL`: the placeholders are what
 * Leaflet and the offline downloader consume, and a self-hosted tileserver URL
 * can carry two `?` segments that `URL.toString()` would re-serialise.
 * `resolveTileUrl` uses one `String.replace` per token, so a repeated token
 * would silently leave a literal `{z}` in the request — hence the once-only
 * rule. `{-y}` (TMS) needs Leaflet's `tms: true` and is not wired here.
 */
export function validateTileUrlTemplate(template: string): string | null {
  const t = template.trim();
  if (t === "") return "Enter a tile URL template.";
  if (!/^https?:\/\//i.test(t)) return "Tile URL must start with http:// or https://.";
  if (t.includes("{-y}")) return "TMS templates ({-y}) are not supported. Use {y}.";
  for (const token of ["{z}", "{x}", "{y}"] as const) {
    const count = t.split(token).length - 1;
    if (count === 0) return `Tile URL must contain ${token}.`;
    if (count > 1) return `Tile URL must contain ${token} only once.`;
  }
  return null;
}

/**
 * Build a provider for an operator-supplied template. Subdomains come from
 * {@link subdomainsForUrl}, the same list the on-screen layer is given, so the
 * downloader and the map spread requests over the same shards.
 */
export function customTileProvider(custom: CustomTileSource): TileProvider {
  const url = custom.url.trim();
  return {
    kind: "raster",
    url,
    subdomains: subdomainsForUrl(url),
    maxZoom: clampTileZoom(custom.maxZoom),
    avgTileKB: CUSTOM_TILE_AVG_KB,
    attribution: custom.attribution,
    name: CUSTOM_BASEMAP_NAME,
    label: CUSTOM_BASEMAP_LABEL,
  };
}

/** ZXY template for one pack served by a ground agent. */
export function fieldPackTileUrl(baseUrl: string, pack: string): string {
  return `${baseUrl}/api/v1/ground-station/tiles/${encodeURIComponent(pack)}/{z}/{x}/{y}.mvt`;
}

/**
 * Build the provider for one ground-station tile pack. Vector, so MapLibre
 * draws it; the pack's own max zoom bounds tile requests and MapLibre
 * overzooms past it.
 */
export function fieldPackProvider(baseUrl: string, pack: { name: string; maxzoom: number }): TileProvider {
  return {
    kind: "vector",
    url: fieldPackTileUrl(baseUrl, pack.name),
    subdomains: [],
    maxZoom: pack.maxzoom,
    avgTileKB: TILE_PROVIDERS["streets-dark"].avgTileKB,
    attribution: VECTOR_BASEMAP_ATTRIBUTION,
    name: `${FIELD_PACK_BASEMAP_NAME}: ${pack.name}`,
    label: FIELD_PACK_BASEMAP_LABEL,
    flavor: "dark",
  };
}

/**
 * Resolve the provider a source id selects. A `"custom"` id with an unusable
 * template resolves to `dark`: an empty or malformed template makes Leaflet
 * request garbage URLs forever and paints nothing. `"field-pack"` resolves to
 * the ground station's pack when one is reachable, else to the hosted vector
 * streets basemap, the closest equivalent.
 */
export function resolveBasemap(
  source: MapTileSource,
  custom: CustomTileSource,
  fieldPack?: TileProvider | null,
): TileProvider {
  if (source === "custom") {
    return validateTileUrlTemplate(custom.url) === null
      ? customTileProvider(custom)
      : TILE_PROVIDERS.dark;
  }
  if (source === "field-pack") return fieldPack ?? TILE_PROVIDERS["streets-dark"];
  // Guards a persisted id from a build that carried a provider this one does not.
  return TILE_PROVIDERS[source] ?? TILE_PROVIDERS.dark;
}

/**
 * Resolve a single tile URL from a template, as the offline downloader
 * requests it. The subdomain uses the same `Math.abs(x + y) % len` scheme
 * Leaflet uses internally, and `{r}` resolves to `@2x` on HiDPI displays
 * (only for templates that carry an `{r}` slot, so non-retina providers are
 * never affected). The cache key (`tileCacheKey`) folds the shard away, so a
 * downloaded tile is found whichever shard the map asks.
 */
export function resolveTileUrl(
  urlTemplate: string,
  subdomains: string[],
  x: number,
  y: number,
  z: number,
  retina: boolean,
): string {
  const s = subdomains.length > 0
    ? subdomains[Math.abs(x + y) % subdomains.length]
    : "";
  return urlTemplate
    .replace("{s}", s)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{r}", retina ? "@2x" : "");
}

/**
 * Generate all tile URLs for a bounding box and zoom range.
 * Yields URLs one at a time to avoid allocating a massive array.
 * URLs are built through {@link resolveTileUrl} so they match the on-screen
 * cached layer byte-for-byte, including the `@2x` retina variant and the
 * subdomain scheme.
 */
export function* generateTileUrls(
  bounds: LatLngBounds,
  zMin: number,
  zMax: number,
  provider: TileProvider,
  retina: boolean = isRetinaDisplay(),
): Generator<string> {
  for (let z = zMin; z <= zMax; z++) {
    const yMin = latToTileY(bounds.north, z);
    const yMax = latToTileY(bounds.south, z);

    for (const [xMin, xMax] of tileXRanges(bounds, z)) {
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          yield resolveTileUrl(provider.url, provider.subdomains, x, y, z, retina);
        }
      }
    }
  }
}

/** Format bytes as human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
