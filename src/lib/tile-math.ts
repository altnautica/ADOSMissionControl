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
}

/** Every basemap id except the operator-supplied one. */
export type BuiltInTileSource = Exclude<MapTileSource, "custom">;

export const TILE_PROVIDERS: Record<BuiltInTileSource, TileProvider> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 20,
    avgTileKB: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    name: "CARTO Dark",
    label: "DARK",
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 19,
    avgTileKB: 25,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    name: "OpenStreetMap",
    label: "OSM",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    maxZoom: 18,
    avgTileKB: 40,
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    name: "Esri Satellite",
    label: "SAT",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 17,
    avgTileKB: 20,
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    name: "OpenTopoMap",
    label: "TOPO",
  },
};

/** Convert longitude to tile X index at zoom z. */
export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

/** Convert latitude to tile Y index at zoom z. */
export function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

/** Count tiles in a bounding box at a specific zoom level. */
export function tileCountAtZoom(bounds: LatLngBounds, z: number): number {
  const xMin = lonToTileX(bounds.west, z);
  const xMax = lonToTileX(bounds.east, z);
  const yMin = latToTileY(bounds.north, z);
  const yMax = latToTileY(bounds.south, z);
  return (xMax - xMin + 1) * (yMax - yMin + 1);
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
export const BASEMAP_ORDER: MapTileSource[] = ["dark", "osm", "satellite", "terrain", "custom"];
export const CUSTOM_BASEMAP_LABEL = "CUSTOM";
export const CUSTOM_BASEMAP_NAME = "Custom (self-hosted)";
/** Size estimate for a custom source, between OSM's 25 and Esri's 40. */
export const CUSTOM_TILE_AVG_KB = 25;
export const DEFAULT_CUSTOM_TILE_MAX_ZOOM = 19;
export const MIN_CUSTOM_TILE_MAX_ZOOM = 1;
export const MAX_CUSTOM_TILE_MAX_ZOOM = 24;

/** Short uppercase label for the segmented basemap control. */
export function basemapLabel(source: MapTileSource): string {
  return source === "custom" ? CUSTOM_BASEMAP_LABEL : TILE_PROVIDERS[source].label;
}

/** Long-form menu name. */
export function basemapName(source: MapTileSource): string {
  return source === "custom" ? CUSTOM_BASEMAP_NAME : TILE_PROVIDERS[source].name;
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
 * {@link subdomainsForUrl} — the same function `CachedTileLayer.getTileUrl`
 * calls — so the downloader's write key and the on-screen read key stay
 * byte-identical for a template that carries `{s}`.
 */
export function customTileProvider(custom: CustomTileSource): TileProvider {
  const url = custom.url.trim();
  return {
    url,
    subdomains: subdomainsForUrl(url),
    maxZoom: clampTileZoom(custom.maxZoom),
    avgTileKB: CUSTOM_TILE_AVG_KB,
    attribution: custom.attribution,
    name: CUSTOM_BASEMAP_NAME,
    label: CUSTOM_BASEMAP_LABEL,
  };
}

/**
 * Resolve the provider a source id selects. A `"custom"` id with an unusable
 * template resolves to `dark`: an empty or malformed template makes Leaflet
 * request garbage URLs forever and paints nothing.
 */
export function resolveBasemap(source: MapTileSource, custom: CustomTileSource): TileProvider {
  if (source === "custom") {
    return validateTileUrlTemplate(custom.url) === null
      ? customTileProvider(custom)
      : TILE_PROVIDERS.dark;
  }
  // Guards a persisted id from a build that carried a provider this one does not.
  return TILE_PROVIDERS[source] ?? TILE_PROVIDERS.dark;
}

/**
 * Resolve a single tile URL from a template. This is the ONE place both the
 * offline downloader and the on-screen cached layer build a tile URL, so the
 * write key and the read key are byte-for-byte identical. The subdomain uses
 * the same `Math.abs(x + y) % len` scheme Leaflet uses internally, and `{r}`
 * resolves to `@2x` on HiDPI displays (only for templates that carry an `{r}`
 * slot, so non-retina providers are never affected).
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
    const xMin = lonToTileX(bounds.west, z);
    const xMax = lonToTileX(bounds.east, z);
    const yMin = latToTileY(bounds.north, z);
    const yMax = latToTileY(bounds.south, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        yield resolveTileUrl(provider.url, provider.subdomains, x, y, z, retina);
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
