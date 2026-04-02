/**
 * @module airspace/geo-utils
 * @description Shared geodetic utilities for airspace zone providers.
 * @license GPL-3.0-only
 */

import type { GeoJSONPolygon, BoundingBox } from "./types";

/** Generate a GeoJSON polygon approximating a circle on the globe. */
export function circlePolygon(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  points = 32,
): GeoJSONPolygon {
  const coords: number[][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const lat = centerLat + (radiusKm / 111.32) * Math.cos(angle);
    const lon =
      centerLon +
      (radiusKm / (111.32 * Math.cos(centerLat * (Math.PI / 180)))) *
        Math.sin(angle);
    coords.push([lon, lat]); // GeoJSON: [lon, lat]
  }
  return { type: "Polygon", coordinates: [coords] };
}

/** Check if a lat/lon point is within a bounding box. */
export function inBbox(lat: number, lon: number, bbox: BoundingBox): boolean {
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}
