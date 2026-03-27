/**
 * @module formats/kml-parser
 * @description Parse KML XML into waypoints, polygons, and paths.
 * Uses the browser DOMParser API (no extra dependencies).
 *
 * CRITICAL: KML coordinate order is lon,lat,alt — opposite of our lat,lon convention.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";

export interface KmlStyle {
  lineColor: string;  // CSS hex (#RRGGBB)
  fillColor: string;
  lineWidth: number;
}

export interface KmlParseResult {
  waypoints: Waypoint[];
  /** Polygon boundaries (for use with survey pattern generator). */
  polygons: [number, number][][];
  /** Path lines (for use with corridor pattern generator). */
  paths: [number, number][][];
  /** Point-only markers (lat, lon). */
  points: [number, number][];
  /** Document name, if present. */
  name: string;
  /** Extracted style (from first Style element, or default). */
  style: KmlStyle;
}

/**
 * Parse a KML XML string into waypoints, polygons, and paths.
 */
export function parseKML(text: string): KmlParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");

  const waypoints: Waypoint[] = [];
  const polygons: [number, number][][] = [];
  const paths: [number, number][][] = [];
  const points: [number, number][] = [];

  // Extract document name
  const docElements = findElements(doc, "Document");
  const nameElements = docElements.length > 0 ? findElements(docElements[0], "name") : [];
  const docName = nameElements.length > 0 ? (nameElements[0].textContent ?? "KML Overlay") : "KML Overlay";

  // Extract style
  const style = extractStyle(doc);

  // Handle namespaced and non-namespaced KML.
  // getElementsByTagName("*") + local name matching works across namespaces.
  const placemarks = findElements(doc, "Placemark");

  for (const pm of placemarks) {
    // Point → single waypoint + overlay point
    const pointElements = findElements(pm, "Point");
    for (const point of pointElements) {
      const coords = getCoordinatesText(point);
      if (coords) {
        const parsed = parseCoordinateString(coords);
        if (parsed.length > 0) {
          const [lat, lon, alt] = [parsed[0][0], parsed[0][1], parsed[0][2]];
          points.push([lat, lon]);
          waypoints.push({
            id: generateId(),
            lat,
            lon,
            alt: alt ?? 0,
            command: "WAYPOINT",
          });
        }
      }
    }

    // LineString → path
    const lineStrings = findElements(pm, "LineString");
    for (const ls of lineStrings) {
      const coords = getCoordinatesText(ls);
      if (coords) {
        const parsed = parseCoordinateString(coords);
        if (parsed.length > 0) {
          const path: [number, number][] = parsed.map((p) => [p[0], p[1]]);
          paths.push(path);

          // Also add each point as a waypoint
          for (const p of parsed) {
            waypoints.push({
              id: generateId(),
              lat: p[0],
              lon: p[1],
              alt: p[2] ?? 0,
              command: "WAYPOINT",
            });
          }
        }
      }
    }

    // Polygon → boundary
    const polyElements = findElements(pm, "Polygon");
    for (const poly of polyElements) {
      // Outer boundary
      const outerBound = findElements(poly, "outerBoundaryIs");
      for (const ob of outerBound) {
        const linearRing = findElements(ob, "LinearRing");
        for (const lr of linearRing) {
          const coords = getCoordinatesText(lr);
          if (coords) {
            const parsed = parseCoordinateString(coords);
            if (parsed.length >= 3) {
              const boundary: [number, number][] = parsed.map((p) => [p[0], p[1]]);
              // KML polygons are closed (first == last), remove duplicate closing vertex
              if (
                boundary.length > 1 &&
                boundary[0][0] === boundary[boundary.length - 1][0] &&
                boundary[0][1] === boundary[boundary.length - 1][1]
              ) {
                boundary.pop();
              }
              polygons.push(boundary);
            }
          }
        }
      }
    }
  }

  return { waypoints, polygons, paths };
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Parse a KML coordinates string into [lat, lon, alt] arrays.
 * KML format: "lon,lat,alt lon,lat,alt ..." (space-separated tuples, lon comes first).
 */
function parseCoordinateString(text: string): [number, number, number][] {
  const result: [number, number, number][] = [];
  const trimmed = text.trim();
  if (!trimmed) return result;

  // Split by whitespace (spaces, newlines, tabs)
  const tuples = trimmed.split(/\s+/);
  for (const tuple of tuples) {
    const parts = tuple.split(",");
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length >= 3 ? parseFloat(parts[2]) : 0;
      if (!isNaN(lat) && !isNaN(lon)) {
        // Swap from KML lon,lat to our lat,lon
        result.push([lat, lon, isNaN(alt) ? 0 : alt]);
      }
    }
  }

  return result;
}

/**
 * Find elements by local name (handles both namespaced and non-namespaced KML).
 */
function findElements(parent: Element | Document, localName: string): Element[] {
  const results: Element[] = [];
  const all = parent.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) {
      results.push(all[i]);
    }
  }
  return results;
}

/**
 * Get the text content of the first <coordinates> child element.
 */
function getCoordinatesText(parent: Element): string | null {
  const coords = findElements(parent, "coordinates");
  if (coords.length > 0 && coords[0].textContent) {
    return coords[0].textContent;
  }
  return null;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
