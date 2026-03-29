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
}

export const TILE_PROVIDERS: Record<string, TileProvider> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 20,
    avgTileKB: 20,
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 19,
    avgTileKB: 25,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    maxZoom: 18,
    avgTileKB: 40,
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 17,
    avgTileKB: 20,
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
 * Generate all tile URLs for a bounding box and zoom range.
 * Yields URLs one at a time to avoid allocating a massive array.
 */
export function* generateTileUrls(
  bounds: LatLngBounds,
  zMin: number,
  zMax: number,
  provider: TileProvider,
): Generator<string> {
  for (let z = zMin; z <= zMax; z++) {
    const xMin = lonToTileX(bounds.west, z);
    const xMax = lonToTileX(bounds.east, z);
    const yMin = latToTileY(bounds.north, z);
    const yMax = latToTileY(bounds.south, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const s = provider.subdomains.length > 0
          ? provider.subdomains[(x + y) % provider.subdomains.length]
          : "";

        yield provider.url
          .replace("{s}", s)
          .replace("{z}", String(z))
          .replace("{x}", String(x))
          .replace("{y}", String(y))
          .replace("{r}", "");
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
