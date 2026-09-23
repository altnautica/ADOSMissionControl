/**
 * @module patterns/survey-generator
 * @description Generates survey/grid (lawnmower) flight patterns from a polygon boundary.
 *
 * Algorithm:
 * 1. Rotate polygon so the grid aligns with the desired angle
 * 2. Compute bounding box of rotated polygon
 * 3. Generate parallel horizontal transects at lineSpacing intervals
 * 4. Clip each transect to the rotated polygon boundary
 * 5. Order transects in boustrophedon (serpentine) pattern
 * 6. Rotate waypoints back to original orientation
 * 7. Add turn-around overshoot, entry location, camera triggers
 *
 * @license GPL-3.0-only
 */

import type { SurveyConfig, PatternResult, PatternWaypoint } from "./types";
import {
  bearing,
  offsetPoint,
  polygonArea,
  polygonCentroid,
} from "@/lib/drawing/geo-utils";
import { EARTH_RADIUS_M, haversineDistance, pointInPolygon } from "@/lib/geo/distance";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ── Local projection helpers ─────────────────────────────────
// Project lat/lon to flat meters around a reference point,
// then back. Good enough for areas under ~50 km.

function toLocal(
  lat: number,
  lon: number,
  refLat: number,
  refLon: number,
  cosRef: number
): [number, number] {
  return [
    (lon - refLon) * DEG_TO_RAD * EARTH_RADIUS_M * cosRef,
    (lat - refLat) * DEG_TO_RAD * EARTH_RADIUS_M,
  ];
}

function toGeo(
  x: number,
  y: number,
  refLat: number,
  refLon: number,
  cosRef: number
): [number, number] {
  return [
    refLat + (y / EARTH_RADIUS_M) * RAD_TO_DEG,
    refLon + (x / (EARTH_RADIUS_M * cosRef)) * RAD_TO_DEG,
  ];
}

function rotateXY(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

// ── Line-segment intersection with polygon edges ─────────────
// Returns all intersection x-coordinates of a horizontal line at y
// with the polygon edges. Used to clip transects.

function horizontalIntersections(
  polygon: [number, number][],
  y: number
): number[] {
  const xs: number[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
      const t = (y - y1) / (y2 - y1);
      xs.push(x1 + t * (x2 - x1));
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

// ── Exclusion (keep-out) support ─────────────────────────────
// A survey pattern may skip one or more exclusion polygons (keep-out holes)
// that sit inside the boundary. Each transect is split at the hole edges so no
// generated line or waypoint enters an excluded area. With no exclusions the
// generation is byte-identical to a plain boundary survey.

/** Survey config plus optional keep-out rings (each a closed [lat, lon] ring) the transects must avoid. */
export type SurveyGenConfig = SurveyConfig & { exclusions?: [number, number][][] };

/**
 * A clipped transect span in rotated local space, tagged with whether each end
 * came from a hole edge (a clip) rather than the boundary. A hole-edge end must
 * never receive turn-around overshoot (it would push a waypoint into the keep-out).
 */
interface Transect {
  startX: number;
  endX: number;
  y: number;
  startClipped: boolean;
  endClipped: boolean;
}

/**
 * Subtract a set of hole intervals from a single [a, b] span on one scan line,
 * returning the surviving sub-spans in ascending order. Each surviving span
 * records whether its start/end is a hole-edge clip (vs. the original boundary).
 */
function subtractHoleIntervals(
  a: number,
  b: number,
  holes: [number, number][]
): { start: number; end: number; startClipped: boolean; endClipped: boolean }[] {
  if (a >= b) return [];
  const EPS = 1e-6;
  const sorted = holes
    .map(([lo, hi]) => (lo <= hi ? ([lo, hi] as [number, number]) : ([hi, lo] as [number, number])))
    .filter(([lo, hi]) => hi > a && lo < b)
    .sort((p, q) => p[0] - q[0]);

  const out: { start: number; end: number; startClipped: boolean; endClipped: boolean }[] = [];
  let cursor = a;
  for (const [lo, hi] of sorted) {
    const gapEnd = Math.max(lo, a);
    if (gapEnd - cursor > EPS) {
      out.push({ start: cursor, end: gapEnd, startClipped: cursor !== a, endClipped: true });
    }
    cursor = Math.max(cursor, Math.min(hi, b));
    if (cursor >= b) break;
  }
  if (b - cursor > EPS) {
    out.push({ start: cursor, end: b, startClipped: cursor !== a, endClipped: false });
  }
  return out;
}

// ── Main generator ───────────────────────────────────────────

/**
 * Internal single-pass survey generator.
 * The public generateSurvey() wraps this to support crosshatch (double grid).
 */
function generateSinglePass(config: SurveyGenConfig): PatternResult {
  const {
    polygon,
    gridAngle,
    lineSpacing,
    turnAroundDistance,
    entryLocation,
    flyAlternateTransects,
    cameraTriggerDistance,
    altitude,
    speed,
    exclusions,
  } = config;

  if (polygon.length < 3 || lineSpacing <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  // Reference point = polygon centroid
  const [refLat, refLon] = polygonCentroid(polygon);
  const cosRef = Math.cos(refLat * DEG_TO_RAD);

  // Project polygon to local XY meters
  const localPoly: [number, number][] = polygon.map(([lat, lon]) =>
    toLocal(lat, lon, refLat, refLon, cosRef)
  );

  // Rotate polygon so the grid lines become horizontal
  const angleRad = -gridAngle * DEG_TO_RAD;
  const rotatedPoly: [number, number][] = localPoly.map(([x, y]) =>
    rotateXY(x, y, angleRad)
  );

  // Project + rotate exclusion (keep-out) rings into the same rotated local
  // space so their scan-line crossings can be subtracted from each transect.
  const rotatedExclusions: [number, number][][] = (exclusions ?? [])
    .filter((ring) => ring.length >= 3)
    .map((ring) =>
      ring.map(([lat, lon]) => {
        const [lx, ly] = toLocal(lat, lon, refLat, refLon, cosRef);
        return rotateXY(lx, ly, angleRad);
      })
    );

  // Bounding box of rotated polygon
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of rotatedPoly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Generate transects (horizontal lines in rotated space). Where exclusion
  // (keep-out) holes are present, split each transect at the hole edges so no
  // line or waypoint enters an excluded area.
  const transects: Transect[] = [];
  const firstY = minY + lineSpacing / 2;
  for (let y = firstY; y <= maxY; y += lineSpacing) {
    const xs = horizontalIntersections(rotatedPoly, y);

    // Hole crossings on this scan line (union across all exclusion polygons).
    const holeIntervals: [number, number][] = [];
    for (const ex of rotatedExclusions) {
      const hxs = horizontalIntersections(ex, y);
      for (let h = 0; h + 1 < hxs.length; h += 2) {
        holeIntervals.push([hxs[h], hxs[h + 1]]);
      }
    }

    // Each pair of boundary x-intersections forms a transect segment; subtract
    // any hole intervals so the segment breaks around keep-out zones.
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (holeIntervals.length === 0) {
        transects.push({ startX: xs[k], endX: xs[k + 1], y, startClipped: false, endClipped: false });
      } else {
        for (const p of subtractHoleIntervals(xs[k], xs[k + 1], holeIntervals)) {
          transects.push({ startX: p.start, endX: p.end, y, startClipped: p.startClipped, endClipped: p.endClipped });
        }
      }
    }
  }

  if (transects.length === 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  // Skip every other SCAN LINE if requested. Keying on the transect's scan-line
  // coordinate (y) — not its flat array index — is what makes this correct when
  // exclusion holes split a single scan line into several transect segments that
  // share the same y: those segments are kept or dropped together.
  let activeTransects: Transect[] = transects;
  if (flyAlternateTransects && transects.length > 1) {
    const scanLineYs = [...new Set(transects.map((t) => t.y))].sort((a, b) => a - b);
    const keptYs = new Set(scanLineYs.filter((_, i) => i % 2 === 0));
    activeTransects = transects.filter((t) => keptYs.has(t.y));
  }

  // Boustrophedon ordering: alternate left-to-right and right-to-left. Swapping
  // the ends must also swap their clip flags so overshoot suppression follows.
  const orderedTransects: Transect[] = activeTransects.map((t, i) => {
    if (i % 2 === 1) {
      return { startX: t.endX, endX: t.startX, y: t.y, startClipped: t.endClipped, endClipped: t.startClipped };
    }
    return t;
  });

  // Entry location flipping
  const flipHorizontal = entryLocation === "topRight" || entryLocation === "bottomRight";
  const flipVertical = entryLocation === "bottomLeft" || entryLocation === "bottomRight";

  if (flipVertical) orderedTransects.reverse();
  if (flipHorizontal) {
    for (const t of orderedTransects) {
      const tmpX = t.startX;
      t.startX = t.endX;
      t.endX = tmpX;
      const tmpC = t.startClipped;
      t.startClipped = t.endClipped;
      t.endClipped = tmpC;
    }
  }

  // Rotate back and convert to geo coordinates, building waypoints
  const reverseAngle = gridAngle * DEG_TO_RAD;
  const waypoints: PatternWaypoint[] = [];
  const previewLines: [[number, number], [number, number]][] = [];

  for (const t of orderedTransects) {
    // Compute overshoot direction
    const dx = t.endX - t.startX;
    const overshootDir = dx >= 0 ? 1 : -1;

    // Turn-around overshoot, suppressed at hole-edge ends so a waypoint is never
    // pushed into a keep-out zone. Non-clipped (boundary) ends keep the overshoot.
    const startTurn = t.startClipped ? 0 : turnAroundDistance;
    const endTurn = t.endClipped ? 0 : turnAroundDistance;
    const sxOv = t.startX - overshootDir * startTurn;
    const exOv = t.endX + overshootDir * endTurn;

    // Rotate back to local space
    const [sx, sy] = rotateXY(sxOv, t.y, reverseAngle);
    const [ex, ey] = rotateXY(exOv, t.y, reverseAngle);

    const startGeo = toGeo(sx, sy, refLat, refLon, cosRef);
    const endGeo = toGeo(ex, ey, refLat, refLon, cosRef);

    // Preview line (without overshoot, for the map overlay)
    const [psx, psy] = rotateXY(t.startX, t.y, reverseAngle);
    const [pex, pey] = rotateXY(t.endX, t.y, reverseAngle);
    const previewStart = toGeo(psx, psy, refLat, refLon, cosRef);
    const previewEnd = toGeo(pex, pey, refLat, refLon, cosRef);
    previewLines.push([previewStart, previewEnd]);

    // Start waypoint
    waypoints.push({
      lat: startGeo[0],
      lon: startGeo[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // Camera trigger on for this transect. An action fires after the
    // navigation point it follows, so it rides the start waypoint and the
    // camera runs only along the transect, not across the turnaround.
    if (cameraTriggerDistance > 0) {
      waypoints.push({
        lat: startGeo[0],
        lon: startGeo[1],
        alt: altitude,
        speed,
        command: "DO_SET_CAM_TRIGG",
        param1: cameraTriggerDistance,
      });
    }

    // End waypoint
    waypoints.push({
      lat: endGeo[0],
      lon: endGeo[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // Camera trigger off at the transect end
    if (cameraTriggerDistance > 0) {
      waypoints.push({
        lat: endGeo[0],
        lon: endGeo[1],
        alt: altitude,
        speed,
        command: "DO_SET_CAM_TRIGG",
        param1: 0,
      });
    }
  }

  // Stats — sum distances between navigation waypoints only (exclude camera triggers)
  const navWaypoints = waypoints.filter((wp) => wp.command === "WAYPOINT" || wp.command === "SPLINE_WAYPOINT");
  let totalDistance = 0;
  for (let i = 1; i < navWaypoints.length; i++) {
    totalDistance += haversineDistance(
      navWaypoints[i - 1].lat, navWaypoints[i - 1].lon,
      navWaypoints[i].lat, navWaypoints[i].lon
    );
  }

  // Covered area is the boundary minus the exclusion (keep-out) holes the survey
  // deliberately skipped — reporting the full boundary would overstate coverage.
  // Only holes whose centroid lies inside the boundary count; an exclusion drawn
  // entirely outside the survey area does not reduce coverage (and must not, per
  // the "outside exclusion changes nothing" contract).
  const exclusionArea = (exclusions ?? []).reduce((sum, ring) => {
    if (ring.length < 3) return sum;
    return pointInPolygon(polygonCentroid(ring), polygon) ? sum + polygonArea(ring) : sum;
  }, 0);
  const area = Math.max(0, polygonArea(polygon) - exclusionArea);
  const estimatedTime = speed > 0 ? totalDistance / speed : 0;
  const photoCount = cameraTriggerDistance > 0
    ? Math.floor(totalDistance / cameraTriggerDistance)
    : 0;

  return {
    waypoints,
    stats: {
      totalDistance,
      estimatedTime,
      photoCount,
      coveredArea: area,
      transectCount: orderedTransects.length,
    },
    previewLines,
  };
}

/**
 * Generate a survey pattern. If crosshatch is enabled, runs two passes
 * at gridAngle and gridAngle+90, concatenating the results.
 */
export function generateSurvey(config: SurveyGenConfig): PatternResult {
  const firstPass = generateSinglePass(config);

  const hasTieLines = config.tieLines && !config.crosshatch;
  if (!config.crosshatch && !hasTieLines) {
    return firstPass;
  }

  // Tie lines: configurable angle and spacing; crosshatch: fixed 90 deg, same spacing
  const tieAngle = hasTieLines ? (config.tieLineAngle ?? 90) : 90;
  const tieSpacing = hasTieLines ? (config.tieLineSpacing ?? config.lineSpacing) : config.lineSpacing;

  const secondPass = generateSinglePass({
    ...config,
    gridAngle: (config.gridAngle + tieAngle) % 360,
    lineSpacing: tieSpacing,
  });

  // Merge results
  const waypoints = [...firstPass.waypoints, ...secondPass.waypoints];
  const previewLines = [
    ...(firstPass.previewLines ?? []),
    ...(secondPass.previewLines ?? []),
  ];

  return {
    waypoints,
    stats: {
      totalDistance: firstPass.stats.totalDistance + secondPass.stats.totalDistance,
      estimatedTime: firstPass.stats.estimatedTime + secondPass.stats.estimatedTime,
      photoCount: firstPass.stats.photoCount + secondPass.stats.photoCount,
      coveredArea: firstPass.stats.coveredArea, // Same polygon, counted once
      transectCount: firstPass.stats.transectCount + secondPass.stats.transectCount,
    },
    previewLines,
  };
}
