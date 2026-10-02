/**
 * @module formats/kml-boundary
 * @description Extract boundary polygons (outer ring plus interior holes) from
 * KML text, delegating to the shared KML parser which already handles
 * namespaces, the lon,lat -> lat,lon swap, and the closing-vertex trim.
 *
 * CRITICAL: KML coordinate order is lon,lat. {@link parseKML} performs the swap,
 * so the rings returned here are already in our lat,lon convention.
 *
 * @license GPL-3.0-only
 */

import { parseKML } from "./kml-parser";

/**
 * An imported boundary: the outer ring and the interior rings (holes) cut out
 * of it, each a `[lat, lon]` ring without the duplicate closing vertex. A hole
 * is an area the boundary excludes (a building, a pond, a restricted plot), so
 * a survey over the boundary must keep out of it.
 */
export interface BoundaryPolygon {
  outer: [number, number][];
  holes: [number, number][][];
}

/**
 * Parse KML text and return its polygon boundaries with their holes.
 *
 * Returns an empty array when the document carries no polygon — never a
 * fabricated shape.
 *
 * @param text Raw KML XML string (also works on the doc.kml extracted from a KMZ).
 */
export function parseKmlBoundary(text: string): BoundaryPolygon[] {
  const { polygons, polygonHoles } = parseKML(text);
  return polygons.map((outer, i) => ({ outer, holes: polygonHoles[i] ?? [] }));
}
