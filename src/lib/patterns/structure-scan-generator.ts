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
  haversineDistance,
  offsetPoint,
  polygonCentroid,
} from "@/lib/drawing/geo-utils";

export interface StructureScanConfig {
  /** Structure boundary polygon vertices [lat, lon] */
  structurePolygon: [number, number][];
  /** Bottom altitude of scan (meters AGL) */
  bottomAlt: number;
  /** Top altitude of scan (meters AGL) */
  topAlt: number;
  /** Vertical spacing between scan layers (meters) */
  layerSpacing: number;
  /** Horizontal distance from structure boundary to fly (meters) */
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
 * 1. Compute the centroid of the structure polygon
 * 2. For each altitude layer (from bottom to top or vice versa):
 *    a. Generate orbit points at scanDistance from centroid
 *    b. Each point has ROI set to structure centroid (camera looks inward)
 *    c. Insert camera trigger if configured
 * 3. Connect layers with transit waypoints
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

  // Compute centroid
  const center = polygonCentroid(structurePolygon);

  // Compute average radius from centroid to boundary + scan distance
  let avgRadius = 0;
  for (const vertex of structurePolygon) {
    avgRadius += haversineDistance(center[0], center[1], vertex[0], vertex[1]);
  }
  avgRadius = avgRadius / structurePolygon.length + scanDistance;

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
      const pt = offsetPoint(center[0], center[1], angle, avgRadius);

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
