/**
 * @module formats/kml-parser
 * @description Parse KML XML into waypoints, polygons, and paths.
 * Uses the browser DOMParser API (no extra dependencies).
 *
 * CRITICAL: KML coordinate order is lon,lat,alt — opposite of our lat,lon convention.
 *
 * A Placemark's vertical datum is read rather than discarded: our own exports
 * carry the exact frame in `ExtendedData`, and a third-party document is read
 * from its `altitudeMode` (`absolute` -> AMSL, `relativeToGround` /
 * `clampToGround` -> above terrain). Dropping it made every imported KML
 * default to relative-to-home, which silently changes what the altitude means.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint } from "@/lib/types";
import { KML_FRAME_KEY } from "./kml-exporter";

export interface KmlStyle {
  lineColor: string;  // CSS hex (#RRGGBB)
  fillColor: string;
  lineWidth: number;
}

export interface KmlParseResult {
  waypoints: Waypoint[];
  /** Polygon boundaries (for use with survey pattern generator). */
  polygons: [number, number][][];
  /**
   * Interior rings (holes) of each polygon, index-aligned with `polygons`;
   * an empty list for a polygon without holes.
   */
  polygonHoles: [number, number][][][];
  /** Path lines (for use with corridor pattern generator). */
  paths: [number, number][][];
  /** Point-only markers (lat, lon). */
  points: [number, number][];
  /** Document name, if present. */
  name: string;
  /** Extracted style (from first Style element, or default). */
  style: KmlStyle;
  /** Waypoints whose altitude could not be used as written, named for the importer to show. */
  warnings: string[];
}

export interface KmlParseOptions {
  /**
   * Altitude given to a waypoint whose own altitude is unusable: a
   * `clampToGround` placemark (its altitude is ignored by definition), or a
   * missing or zero altitude. Callers that import waypoints pass the
   * planner's default altitude.
   */
  defaultAlt?: number;
}

/**
 * Parse a KML XML string into waypoints, polygons, and paths.
 */
export function parseKML(text: string, options: KmlParseOptions = {}): KmlParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  // DOMParser does not throw on malformed XML; it returns a <parsererror> document.
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Not a valid KML file: the XML could not be parsed");
  }
  const defaultAlt = options.defaultAlt ?? 0;
  // Counted per source: line vertices become waypoints only in a document with
  // no Point placemarks, so only the source that is kept is reported.
  const unusable = { point: 0, line: 0 };
  /**
   * The altitude to fly: the written one when it means something, else the
   * default. A height our own export marked with its frame is always trusted
   * (a LAND at 0 m relative is real); otherwise a clamped placemark has no
   * altitude, and a missing or zero altitude would put the waypoint on the
   * ground.
   */
  const usableAlt = (alt: number | undefined, mode: PlacemarkAltitude, source: "point" | "line"): number => {
    if (mode.exportedFrame) return alt ?? 0;
    if (mode.clamped || alt === undefined || alt === 0) {
      unusable[source]++;
      return defaultAlt;
    }
    return alt;
  };

  const waypoints: Waypoint[] = [];
  const polygons: [number, number][][] = [];
  const polygonHoles: [number, number][][][] = [];
  const paths: [number, number][][] = [];
  const points: [number, number][] = [];
  /** Vertices harvested from LineStrings, used ONLY when the document carries
   *  no Point placemarks (a foreign track rather than a mission). */
  const lineStringWaypoints: Waypoint[] = [];

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
    // Vertical datum for every geometry in this Placemark.
    const mode = placemarkAltitude(pm);
    const frame = mode.frame;

    // Point → single waypoint + overlay point
    const pointElements = findElements(pm, "Point");
    for (const point of pointElements) {
      const coords = getCoordinatesText(point);
      if (coords) {
        const parsed = parseCoordinateString(coords);
        if (parsed.length > 0) {
          const [lat, lon, alt] = parsed[0];
          points.push([lat, lon]);
          waypoints.push({
            id: generateId(),
            lat,
            lon,
            alt: usableAlt(alt, mode, "point"),
            command: "WAYPOINT",
            frame,
          });
        }
      }
    }

    // LineString → path overlay.
    //
    // Its vertices are NOT pushed as waypoints here. Our own export writes one
    // "Flight Path" LineString AND one Point Placemark per waypoint, so doing
    // both doubled every waypoint on a round trip. A LineString-only document
    // (a foreign track with no point placemarks) is handled after the loop.
    const lineStrings = findElements(pm, "LineString");
    for (const ls of lineStrings) {
      const coords = getCoordinatesText(ls);
      if (coords) {
        const parsed = parseCoordinateString(coords);
        if (parsed.length > 0) {
          paths.push(parsed.map((p) => [p[0], p[1]] as [number, number]));
          lineStringWaypoints.push(
            ...parsed.map((p) => ({
              id: generateId(),
              lat: p[0],
              lon: p[1],
              alt: usableAlt(p[2], mode, "line"),
              command: "WAYPOINT" as const,
              frame,
            })),
          );
        }
      }
    }

    // Polygon → boundary, with its interior rings (holes) kept alongside so an
    // excluded area inside the boundary is not silently surveyed.
    const polyElements = findElements(pm, "Polygon");
    for (const poly of polyElements) {
      const holes: [number, number][][] = [];
      for (const ib of findElements(poly, "innerBoundaryIs")) {
        for (const lr of findElements(ib, "LinearRing")) {
          const ring = linearRingVertices(lr);
          if (ring) holes.push(ring);
        }
      }
      for (const ob of findElements(poly, "outerBoundaryIs")) {
        for (const lr of findElements(ob, "LinearRing")) {
          const boundary = linearRingVertices(lr);
          if (boundary) {
            polygons.push(boundary);
            polygonHoles.push(holes.map((h) => [...h]));
          }
        }
      }
    }
  }

  // A document with Point placemarks IS the waypoint list; its LineStrings are
  // the drawn path through those same points. Only a document with no points
  // at all (a foreign GPS track) contributes waypoints from its line vertices.
  const fromLines = waypoints.length === 0;
  if (fromLines) waypoints.push(...lineStringWaypoints);
  const unusableAltitudes = fromLines ? unusable.line : unusable.point;

  const warnings: string[] = [];
  if (unusableAltitudes > 0 && waypoints.length > 0) {
    warnings.push(
      `${unusableAltitudes} point${unusableAltitudes === 1 ? "" : "s"} had no usable altitude (clamped to ground, missing or 0 m) and were set to ${defaultAlt} m. Check every altitude before flying.`,
    );
  }

  return { waypoints, polygons, polygonHoles, paths, points, name: docName, style, warnings };
}

/**
 * A LinearRing's vertices as `[lat, lon]`, with KML's duplicate closing vertex
 * removed. `null` when the ring has fewer than three coordinates.
 */
function linearRingVertices(lr: Element): [number, number][] | null {
  const coords = getCoordinatesText(lr);
  if (!coords) return null;
  const parsed = parseCoordinateString(coords);
  if (parsed.length < 3) return null;
  const ring: [number, number][] = parsed.map((p) => [p[0], p[1]]);
  // KML rings are closed (first == last); drop the duplicate closing vertex.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring;
}

// ── Helpers ──────────────────────────────────────────────────

interface PlacemarkAltitude {
  /** The altitude frame the coordinates are expressed in; undefined means the mission default. */
  frame: AltitudeFrame | undefined;
  /** The frame came from our own export's `ExtendedData`, so the altitudes are exact. */
  exportedFrame: boolean;
  /** `clampToGround`: the written altitude is ignored by definition. */
  clamped: boolean;
}

/**
 * How a Placemark's altitudes are to be read.
 *
 * Our own export records the exact frame in `ExtendedData`, so that wins.
 * Otherwise `absolute` is AMSL and `relativeToGround` is height above the
 * terrain below the point — our `terrain` frame, NOT `relative` (above home).
 * `clampToGround` carries no altitude at all, so it maps to no frame and the
 * mission default applies, as it does when the document says nothing.
 */
function placemarkAltitude(pm: Element): PlacemarkAltitude {
  for (const data of findElements(pm, "Data")) {
    if (data.getAttribute("name") !== KML_FRAME_KEY) continue;
    const raw = findElements(data, "value")[0]?.textContent?.trim();
    if (raw === "relative" || raw === "absolute" || raw === "terrain") {
      return { frame: raw, exportedFrame: true, clamped: false };
    }
  }

  const mode = findElements(pm, "altitudeMode")[0]?.textContent?.trim();
  if (mode === "absolute") return { frame: "absolute", exportedFrame: false, clamped: false };
  if (mode === "relativeToGround") return { frame: "terrain", exportedFrame: false, clamped: false };
  return { frame: undefined, exportedFrame: false, clamped: mode === "clampToGround" };
}

/**
 * Parse a KML coordinates string into [lat, lon, alt] arrays; `alt` is
 * undefined when the tuple has none.
 * KML format: "lon,lat,alt lon,lat,alt ..." (space-separated tuples, lon comes first).
 */
function parseCoordinateString(text: string): [number, number, number | undefined][] {
  const result: [number, number, number | undefined][] = [];
  const trimmed = text.trim();
  if (!trimmed) return result;

  // Split by whitespace (spaces, newlines, tabs)
  const tuples = trimmed.split(/\s+/);
  for (const tuple of tuples) {
    const parts = tuple.split(",");
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length >= 3 ? parseFloat(parts[2]) : NaN;
      if (!isNaN(lat) && !isNaN(lon)) {
        // Swap from KML lon,lat to our lat,lon
        result.push([lat, lon, isNaN(alt) ? undefined : alt]);
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

/**
 * Extract style info from KML. KML uses AABBGGRR color format.
 * Returns CSS hex (#RRGGBB) colors.
 */
function extractStyle(doc: Document): KmlStyle {
  const defaultStyle: KmlStyle = {
    lineColor: "#3A82FF",
    fillColor: "#3A82FF",
    lineWidth: 2,
  };

  const styles = findElements(doc, "Style");
  if (styles.length === 0) return defaultStyle;

  const style = styles[0];

  // Line style
  const lineStyles = findElements(style, "LineStyle");
  if (lineStyles.length > 0) {
    const colorEl = findElements(lineStyles[0], "color");
    if (colorEl.length > 0 && colorEl[0].textContent) {
      defaultStyle.lineColor = kmlColorToHex(colorEl[0].textContent.trim());
    }
    const widthEl = findElements(lineStyles[0], "width");
    if (widthEl.length > 0 && widthEl[0].textContent) {
      defaultStyle.lineWidth = parseFloat(widthEl[0].textContent) || 2;
    }
  }

  // Poly style
  const polyStyles = findElements(style, "PolyStyle");
  if (polyStyles.length > 0) {
    const colorEl = findElements(polyStyles[0], "color");
    if (colorEl.length > 0 && colorEl[0].textContent) {
      defaultStyle.fillColor = kmlColorToHex(colorEl[0].textContent.trim());
    }
  } else {
    defaultStyle.fillColor = defaultStyle.lineColor;
  }

  return defaultStyle;
}

/**
 * Convert KML AABBGGRR color to CSS #RRGGBB hex.
 * KML format: alpha-blue-green-red (8 hex chars).
 */
function kmlColorToHex(kmlColor: string): string {
  if (kmlColor.length !== 8) return "#3A82FF";
  const r = kmlColor.substring(6, 8);
  const g = kmlColor.substring(4, 6);
  const b = kmlColor.substring(2, 4);
  return `#${r}${g}${b}`;
}
