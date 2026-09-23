/**
 * @module formats/shp-import
 * @description Parse an ESRI shapefile — a zipped bundle (.zip containing
 * .shp/.dbf/.prj) or a bare .shp — into boundary polygon rings, using the
 * `shpjs` library.
 *
 * CRITICAL: GeoJSON coordinate order is lon,lat — opposite of our lat,lon
 * convention. Every extracted vertex is swapped to [lat, lon].
 *
 * @license GPL-3.0-only
 */

import shp from "shpjs";
import type { FeatureCollection, Geometry, Position } from "geojson";

/**
 * The shapefile's coordinates are not latitude/longitude (a projected CRS such
 * as UTM). A bare .shp carries no .prj, so its coordinates cannot be
 * reprojected; the operator must import the zipped bundle with its .prj.
 */
export class ShapefileNotGeographicError extends Error {
  constructor() {
    super("Shapefile coordinates are not latitude/longitude; import the zipped bundle with its .prj.");
    this.name = "ShapefileNotGeographicError";
  }
}

/**
 * Parse a shapefile buffer into polygon boundary rings.
 *
 * Accepts either a zipped shapefile bundle (`.zip`, the common distribution
 * form carrying .shp + .dbf + .prj together) or a bare `.shp` buffer, detected
 * by the leading magic bytes. Returns one outer ring per polygon feature as
 * `[lat, lon]` pairs (GeoJSON lon,lat swapped), with the duplicate closing
 * vertex removed. Returns an empty array when the file carries no polygon
 * geometry or cannot be read. Throws {@link ShapefileNotGeographicError} when a
 * ring's coordinates fall outside latitude/longitude ranges: those are projected
 * coordinates, and guessing their CRS would place the boundary off the planet.
 *
 * @param buffer Raw file bytes (zipped shapefile or bare .shp).
 * @returns Outer boundary rings, `[lat, lon][]` each; empty when none found.
 */
export async function parseShapefile(buffer: ArrayBuffer): Promise<[number, number][][]> {
  const bytes = new Uint8Array(buffer);
  const rings: [number, number][][] = [];

  try {
    if (isZip(bytes)) {
      // Zipped bundle → the default entry point resolves .shp + .dbf + .prj and
      // may return one collection or an array of them (multiple layers).
      const parsed = await shp(buffer);
      const collections = Array.isArray(parsed) ? parsed : [parsed];
      for (const fc of collections) {
        collectRingsFromFeatureCollection(fc, rings);
      }
    } else {
      // Bare .shp → geometry list only (no attribute table).
      const geometries = shp.parseShp(buffer);
      for (const geom of geometries) {
        collectRingsFromGeometry(geom, rings);
      }
    }
  } catch {
    // Malformed / unreadable file — report as "no polygon" to the caller.
    return [];
  }

  const geographic = rings.every((ring) =>
    ring.every(([lat, lon]) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180),
  );
  if (!geographic) throw new ShapefileNotGeographicError();
  return rings;
}

/** ZIP local-file-header magic (PK\x03\x04). */
function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function collectRingsFromFeatureCollection(
  fc: FeatureCollection,
  out: [number, number][][],
): void {
  if (!fc || !Array.isArray(fc.features)) return;
  for (const feature of fc.features) {
    if (feature?.geometry) collectRingsFromGeometry(feature.geometry, out);
  }
}

function collectRingsFromGeometry(geom: Geometry, out: [number, number][][]): void {
  if (!geom) return;
  if (geom.type === "Polygon") {
    pushRing(geom.coordinates[0], out);
  } else if (geom.type === "MultiPolygon") {
    for (const polygon of geom.coordinates) {
      pushRing(polygon[0], out);
    }
  } else if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries) collectRingsFromGeometry(g, out);
  }
  // Points / lines carry no boundary — ignored.
}

/**
 * Convert a GeoJSON outer ring (lon,lat positions, closed) into our lat,lon
 * ring with the duplicate closing vertex removed. Rings with fewer than three
 * distinct vertices are skipped so no fabricated shape is emitted.
 */
function pushRing(outer: Position[] | undefined, out: [number, number][][]): void {
  if (!outer || outer.length < 3) return;
  const ring: [number, number][] = [];
  for (const pos of outer) {
    const lon = pos[0];
    const lat = pos[1];
    if (
      typeof lat === "number" &&
      typeof lon === "number" &&
      !Number.isNaN(lat) &&
      !Number.isNaN(lon)
    ) {
      ring.push([lat, lon]);
    }
  }
  // GeoJSON polygons are closed (first == last) — drop the duplicate vertex.
  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    ring.pop();
  }
  if (ring.length >= 3) out.push(ring);
}
