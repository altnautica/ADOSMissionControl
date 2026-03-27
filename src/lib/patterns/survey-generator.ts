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
 * Adapted from the QGroundControl SurveyComplexItem transect rebuild logic.
 *
 * @license GPL-3.0-only
 */

import type { SurveyConfig, PatternResult, PatternWaypoint } from "./types";
import {
  haversineDistance,
  bearing,
  offsetPoint,
  polygonArea,
  polygonCentroid,
} from "@/lib/drawing/geo-utils";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_R = 6371000;

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
    (lon - refLon) * DEG_TO_RAD * EARTH_R * cosRef,
    (lat - refLat) * DEG_TO_RAD * EARTH_R,
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
    refLat + (y / EARTH_R) * RAD_TO_DEG,
    refLon + (x / (EARTH_R * cosRef)) * RAD_TO_DEG,
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

// ── Main generator ───────────────────────────────────────────

/**
 * Internal single-pass survey generator.
 * The public generateSurvey() wraps this to support crosshatch (double grid).
 */
function generateSinglePass(config: SurveyConfig): PatternResult {
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

  // Bounding box of rotated polygon
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of rotatedPoly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Generate transects (horizontal lines in rotated space)
  const transects: { startX: number; endX: number; y: number }[] = [];
  const firstY = minY + lineSpacing / 2;
  for (let y = firstY; y <= maxY; y += lineSpacing) {
    const xs = horizontalIntersections(rotatedPoly, y);
    // Each pair of x-intersections forms a clipped transect segment
    for (let k = 0; k + 1 < xs.length; k += 2) {
      transects.push({ startX: xs[k], endX: xs[k + 1], y });
    }
  }

  if (transects.length === 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  // Skip every other transect if requested
  let activeTransects = transects;
  if (flyAlternateTransects && transects.length > 1) {
    activeTransects = transects.filter((_, i) => i % 2 === 0);
  }

  // Boustrophedon ordering: alternate left-to-right and right-to-left
  const orderedTransects = activeTransects.map((t, i) => {
    if (i % 2 === 1) {
      return { startX: t.endX, endX: t.startX, y: t.y };
    }
    return t;
  });

  // Entry location flipping
  const flipHorizontal = entryLocation === "topRight" || entryLocation === "bottomRight";
  const flipVertical = entryLocation === "bottomLeft" || entryLocation === "bottomRight";

  if (flipVertical) orderedTransects.reverse();
  if (flipHorizontal) {
    for (const t of orderedTransects) {
      const tmp = t.startX;
      t.startX = t.endX;
      t.endX = tmp;
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

    // Start point (with turn-around overshoot)
    const sxOv = t.startX - overshootDir * turnAroundDistance;
    const exOv = t.endX + overshootDir * turnAroundDistance;

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

    // Camera trigger at transect start (inside polygon)
    if (cameraTriggerDistance > 0) {
      const trigGeo = toGeo(
        ...rotateXY(t.startX, t.y, reverseAngle),
        refLat, refLon, cosRef
      );
      waypoints.push({
        lat: trigGeo[0],
        lon: trigGeo[1],
        alt: altitude,
        speed,
        command: "DO_SET_CAM_TRIGG",
        param1: cameraTriggerDistance,
      });
    }

    // Start waypoint
    waypoints.push({
      lat: startGeo[0],
      lon: startGeo[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // End waypoint
    waypoints.push({
      lat: endGeo[0],
      lon: endGeo[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // Disable camera trigger at transect end
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

  const area = polygonArea(polygon);
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
export function generateSurvey(config: SurveyConfig): PatternResult {
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
