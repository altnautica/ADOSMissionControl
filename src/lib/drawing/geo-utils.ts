/**
 * @module drawing/geo-utils
 * @description Geodetic math utilities for polygon area, centroid, point-in-polygon,
 * offset, bounds, line clipping, convexity, haversine distance, bearing, and formatting.
 * @license GPL-3.0-only
 */

const R = 6371000; // Earth radius in meters

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Haversine distance between two points in meters.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial bearing from point 1 to point 2 in degrees (0-360).
 */
export function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = degToRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(degToRad(lat2));
  const x =
    Math.cos(degToRad(lat1)) * Math.sin(degToRad(lat2)) -
    Math.sin(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.cos(dLon);
  return ((radToDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

/**
 * Polygon area in square meters using the Shoelace formula with geodetic correction.
 * Vertices are [lat, lon] pairs. Returns absolute area.
 */
export function polygonArea(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0;

  // Use spherical excess formula for better accuracy on the globe.
  // For small polygons, approximate with planar Shoelace on projected coordinates.
  const n = vertices.length;
  let area = 0;

  // Project to meters relative to centroid for Shoelace
  const cLat = vertices.reduce((s, v) => s + v[0], 0) / n;
  const cLon = vertices.reduce((s, v) => s + v[1], 0) / n;
  const cosLat = Math.cos(degToRad(cLat));

  const projected: [number, number][] = vertices.map((v) => [
    degToRad(v[1] - cLon) * R * cosLat, // x (east)
    degToRad(v[0] - cLat) * R,           // y (north)
  ]);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += projected[i][0] * projected[j][1];
    area -= projected[j][0] * projected[i][1];
  }

  return Math.abs(area) / 2;
}

/**
 * Geographic centroid of a polygon. Simple average of vertices.
 */
export function polygonCentroid(vertices: [number, number][]): [number, number] {
  if (vertices.length === 0) return [0, 0];
  const n = vertices.length;
  const lat = vertices.reduce((s, v) => s + v[0], 0) / n;
  const lon = vertices.reduce((s, v) => s + v[1], 0) / n;
  return [lat, lon];
}

/**
 * Ray casting algorithm for point-in-polygon test.
 */
export function pointInPolygon(
  point: [number, number],
  polygon: [number, number][]
): boolean {
  const [py, px] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [iy, ix] = polygon[i];
    const [jy, jx] = polygon[j];
    if (iy > py !== jy > py && px < ((jx - ix) * (py - iy)) / (jy - iy) + ix) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Move a point by bearing (degrees) and distance (meters). Vincenty direct formula.
 */
export function offsetPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distance: number
): [number, number] {
  const d = distance / R;
  const brng = degToRad(bearingDeg);
  const lat1 = degToRad(lat);
  const lon1 = degToRad(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [radToDeg(lat2), radToDeg(lon2)];
}

/**
 * Bounding box of polygon vertices.
 */
export function polygonBounds(vertices: [number, number][]): {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
} {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of vertices) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Clip a line segment to a convex polygon using Sutherland-Hodgman.
 * Returns the clipped segment endpoints, or null if fully outside.
 *
 * WARNING: This algorithm only produces correct results for convex polygons.
 * Concave polygons will silently yield incorrect clipping results.
 * Use {@link isConvex} to validate the polygon before calling this function.
 */
export function clipLineToPolygon(
  lineStart: [number, number],
  lineEnd: [number, number],
  polygon: [number, number][]
): [number, number][] | null {
  if (polygon.length >= 3 && !isConvex(polygon)) {
    console.warn("[geo-utils] clipLineToPolygon called with concave polygon — results may be incorrect");
  }
  let output: [number, number][] = [lineStart, lineEnd];

  for (let i = 0; i < polygon.length; i++) {
    if (output.length === 0) return null;
    const edgeStart = polygon[i];
    const edgeEnd = polygon[(i + 1) % polygon.length];
    const input = output;
    output = [];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const currInside = isLeft(edgeStart, edgeEnd, current);
      const prevInside = isLeft(edgeStart, edgeEnd, prev);

      if (currInside) {
        if (!prevInside) {
          const inter = lineIntersect(prev, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = lineIntersect(prev, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }

  return output.length >= 2 ? output : null;
}

function isLeft(
  a: [number, number],
  b: [number, number],
  p: [number, number]
): boolean {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

function lineIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): [number, number] | null {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t =
    ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

/**
 * Check if a polygon is convex. Vertices are [lat, lon].
 */
export function isConvex(vertices: [number, number][]): boolean {
  if (vertices.length < 3) return false;
  const n = vertices.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Check if two line segments (p1-p2 and p3-p4) intersect.
 * Does not count shared endpoints as intersections.
 */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false; // parallel

  const dx = p3[0] - p1[0], dy = p3[1] - p1[1];
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;

  // Use strict inequality to exclude shared endpoints
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/**
 * Check if a polygon's edges self-intersect (bowtie, figure-8, etc.).
 * Returns true if any non-adjacent edges cross each other.
 */
export function isSelfIntersecting(vertices: [number, number][]): boolean {
  const n = vertices.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges (they share a vertex)
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(
        vertices[i], vertices[(i + 1) % n],
        vertices[j], vertices[(j + 1) % n]
      )) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Format distance for display. Uses meters for <1000m, km otherwise.
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

/**
 * Format area for display. Uses m² for <10000, km² otherwise.
 */
export function formatArea(sqMeters: number): string {
  if (sqMeters >= 10000) return `${(sqMeters / 1e6).toFixed(4)} km²`;
  return `${Math.round(sqMeters)} m²`;
}

/**
 * Project a lat/lon by distance (m) at a given bearing (deg).
 * Returns [lat, lon] in degrees.
 */
export function projectByBearing(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number
): [number, number] {
  const brng = degToRad(bearingDeg);
  const lat1 = degToRad(lat);
  const lon1 = degToRad(lon);
  const dByR = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dByR) +
    Math.cos(lat1) * Math.sin(dByR) * Math.cos(brng),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(dByR) * Math.cos(lat1),
    Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2),
  );

  return [radToDeg(lat2), ((radToDeg(lon2) + 540) % 360) - 180];
}

/** Convert guidance line type to Leaflet dashArray value. */
export function getLineTypeDashArray(lineType: "solid" | "dashed" | "dotted"): string | undefined {
  switch (lineType) {
    case "solid": return undefined;
    case "dashed": return "6 4";
    case "dotted": return "2 2";
    default: return undefined;
  }
}

/** GPS fix type labels. */
export const GPS_FIX_LABELS: Record<number, string> = {
  0: "No GPS",
  1: "No Fix",
  2: "2D Fix",
  3: "3D Fix",
  4: "DGPS",
  5: "RTK Float",
  6: "RTK Fixed",
};
