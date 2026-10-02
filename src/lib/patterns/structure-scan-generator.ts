/**
 * @module structure-scan-generator
 * @description Generates a multi-layer structure/facade scan pattern.
 * The drone orbits a structure at multiple altitude layers with the camera
 * pointed inward, creating a complete 3D capture of the structure.
 *
 * Used for building inspection, cell tower inspection, bridge inspection, etc.
 *
 * Pure function: config in → waypoint array out.
 * @license GPL-3.0-only
 */

import type { PatternResult, PatternStats } from "./types";
import {
  offsetPoint,
  polygonCentroid,
} from "@/lib/drawing/geo-utils";
import { haversineDistance } from "@/lib/geo/distance";

export interface StructureScanConfig {
  /** Structure boundary polygon vertices [lat, lon] */
  structurePolygon: [number, number][];
  /** Bottom altitude of scan (meters above home) */
  bottomAlt: number;
  /** Top altitude of scan (meters above home) */
  topAlt: number;
  /** Vertical spacing between scan layers (meters) */
  layerSpacing: number;
  /** Minimum horizontal distance from the structure to fly, along every orbit leg (meters) */
  scanDistance: number;
  /** Gimbal pitch angle pointing inward (degrees, negative = down) */
  gimbalPitch: number;
  /** Points per orbit layer (more = smoother circle) */
  pointsPerLayer: number;
  /** Camera trigger distance along orbit path (meters, 0 = disabled) */
  cameraTriggerDistance: number;
  /** Flight speed (m/s) */
  speed: number;
  /** Scan direction: bottom-up or top-down */
  direction: "bottom-up" | "top-down";
}

/**
 * Generate a multi-layer structure scan pattern.
 *
 * Algorithm:
 * 1. Compute the area centroid of the structure polygon
 * 2. Size the orbit so the whole path keeps `scanDistance` clear of the
 *    structure (see {@link orbitRadiusClearing})
 * 3. For each altitude layer (from bottom to top or vice versa):
 *    a. Generate orbit points on that circle
 *    b. Each point has ROI set to structure centroid (camera looks inward)
 *    c. Insert camera trigger if configured
 * 4. Connect layers with transit waypoints
 */
export function generateStructureScan(config: StructureScanConfig): PatternResult {
  const {
    structurePolygon,
    bottomAlt,
    topAlt,
    layerSpacing,
    scanDistance,
    gimbalPitch,
    pointsPerLayer,
    cameraTriggerDistance,
    speed,
    direction,
  } = config;

  if (structurePolygon.length < 3) {
    return {
      waypoints: [],
      stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
    };
  }

  const waypoints: PatternResult["waypoints"] = [];

  const center = areaCentroid(structurePolygon);
  const orbitRadius = orbitRadiusClearing(structurePolygon, center, scanDistance, pointsPerLayer);

  // Generate altitude layers
  const numLayers = Math.max(1, Math.ceil((topAlt - bottomAlt) / layerSpacing) + 1);
  const altitudes: number[] = [];
  for (let i = 0; i < numLayers; i++) {
    const alt = bottomAlt + i * layerSpacing;
    if (alt <= topAlt) altitudes.push(alt);
  }
  // Ensure top altitude is included
  if (altitudes[altitudes.length - 1] !== topAlt) {
    altitudes.push(topAlt);
  }

  if (direction === "top-down") altitudes.reverse();

  // Generate orbit for each layer. The ROI at the structure centroid and the
  // camera trigger ride the first orbit point: an action fires after the
  // navigation point it follows, so the camera starts on the structure.
  for (let layerIdx = 0; layerIdx < altitudes.length; layerIdx++) {
    const alt = altitudes[layerIdx];

    // Generate orbit points for this layer
    // Alternate direction for efficiency (clockwise on even layers, CCW on odd)
    const clockwise = layerIdx % 2 === 0;

    for (let i = 0; i < pointsPerLayer; i++) {
      const rawAngle = (360 / pointsPerLayer) * i;
      const angle = clockwise ? rawAngle : 360 - rawAngle;
      const pt = offsetPoint(center[0], center[1], angle, orbitRadius);

      waypoints.push({
        lat: pt[0],
        lon: pt[1],
        alt,
        speed,
        command: "WAYPOINT",
      });

      if (layerIdx === 0 && i === 0) {
        waypoints.push({
          lat: center[0],
          lon: center[1],
          alt: (bottomAlt + topAlt) / 2,
          speed,
          command: "ROI",
        });
        if (cameraTriggerDistance > 0) {
          waypoints.push({
            lat: center[0],
            lon: center[1],
            alt,
            speed,
            command: "DO_SET_CAM_TRIGG",
            param1: cameraTriggerDistance,
          });
        }
      }
      // Each layer starts by commanding the gimbal pitch (after the ROI on the
      // first layer, so the ROI does not override it).
      if (i === 0) {
        waypoints.push({
          lat: pt[0],
          lon: pt[1],
          alt,
          speed,
          command: "DO_MOUNT_CONTROL",
          param1: gimbalPitch,
        });
      }
    }
  }

  // Disable camera trigger at end
  if (cameraTriggerDistance > 0) {
    waypoints.push({
      lat: center[0],
      lon: center[1],
      alt: altitudes[altitudes.length - 1],
      speed,
      command: "DO_SET_CAM_TRIGG",
      param1: 0, // disable
    });
  }

  const stats = computeStats(waypoints, speed, cameraTriggerDistance, altitudes.length);

  return {
    waypoints,
    stats,
  };
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Orbit radius that keeps the flown path at least `standoff` metres outside
 * the structure. The structure lies inside the disk of radius `maxVertex`
 * (the farthest vertex) about `center`. The orbit is flown as straight chords
 * between `points` evenly spaced points, and a chord's closest approach to the
 * centre is `R·cos(π/points)`, so the radius is chosen to put every chord
 * `standoff` beyond that disk. An average vertex distance (the old sizing) put
 * the orbit inside elongated footprints.
 */
export function orbitRadiusClearing(
  polygon: readonly [number, number][],
  center: [number, number],
  standoff: number,
  points: number,
): number {
  let maxVertex = 0;
  for (const [lat, lon] of polygon) {
    maxVertex = Math.max(maxVertex, haversineDistance(center[0], center[1], lat, lon));
  }
  const chordFactor = Math.cos(Math.PI / Math.max(3, points));
  return (maxVertex + Math.max(0, standoff)) / chordFactor;
}

/**
 * Area centroid of a small polygon, on a local flat projection. A plain vertex
 * average drifts toward whichever side was digitised with more points; the
 * area centroid does not. Falls back to the vertex average for a degenerate
 * (zero-area) ring.
 */
function areaCentroid(polygon: readonly [number, number][]): [number, number] {
  const [lat0, lon0] = polygonCentroid([...polygon]);
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [aLat, aLon] = polygon[i];
    const [bLat, bLon] = polygon[(i + 1) % polygon.length];
    const ax = (aLon - lon0) * cosLat;
    const ay = aLat - lat0;
    const bx = (bLon - lon0) * cosLat;
    const by = bLat - lat0;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) < 1e-18 || cosLat === 0) return [lat0, lon0];
  return [lat0 + cy / (3 * twiceArea), lon0 + cx / (3 * twiceArea * cosLat)];
}

function computeStats(
  waypoints: PatternResult["waypoints"],
  speed: number,
  triggerDistance: number,
  layerCount: number,
): PatternStats {
  // Distance flown between the orbit points; the ROI, trigger and gimbal rows
  // are actions, not places the aircraft goes.
  const nav = waypoints.filter((w) => w.command === "WAYPOINT");
  let totalDistance = 0;
  for (let i = 1; i < nav.length; i++) {
    totalDistance += haversineDistance(nav[i - 1].lat, nav[i - 1].lon, nav[i].lat, nav[i].lon);
  }

  return {
    totalDistance,
    estimatedTime: speed > 0 ? totalDistance / speed : 0,
    photoCount: triggerDistance > 0 ? Math.ceil(totalDistance / triggerDistance) : 0,
    // A facade scan covers no ground area; 0 keeps the area row hidden.
    coveredArea: 0,
    transectCount: layerCount,
  };
}
