/**
 * @module sar-generators
 * @description Search and Rescue (SAR) pattern generators.
 * Three standard SAR search patterns:
 * 1. Expanding Square — spiral outward from last known position
 * 2. Sector Search — pie-slice sweeps from a datum point
 * 3. Parallel Track — systematic area coverage (like survey but optimized for visual search)
 *
 * All generators are pure functions: config in → waypoint array out.
 * @license GPL-3.0-only
 */

import type { PatternResult, PatternStats } from "./types";
import {
  offsetPoint,
} from "@/lib/drawing/geo-utils";
import { haversineDistance } from "@/lib/geo/distance";

// ── Types ─────────────────────────────────────────────────────

export interface ExpandingSquareConfig {
  center: [number, number]; // [lat, lon] — last known position / datum
  legSpacing: number; // meters between parallel legs
  maxLegs: number; // number of legs (each leg alternates 90deg turns)
  altitude: number;
  speed: number;
  startBearing: number; // degrees from north for first leg
}

export interface SectorSearchConfig {
  center: [number, number]; // [lat, lon] — datum point
  radius: number; // meters — search radius from datum
  sweeps: number; // number of pie-slice sweeps (typically 3)
  altitude: number;
  speed: number;
  startBearing: number; // degrees from north
}

export interface ParallelTrackConfig {
  startPoint: [number, number]; // [lat, lon]
  trackLength: number; // meters — length of each parallel track
  trackSpacing: number; // meters between tracks
  trackCount: number; // number of parallel tracks
  bearing: number; // degrees — direction of tracks
  altitude: number;
  speed: number;
}

// ── Expanding Square ──────────────────────────────────────────

/**
 * Generate an expanding square search pattern.
 * The aircraft flies outward in a square spiral from the datum point,
 * with each pair of legs increasing in length by one spacing unit.
 *
 * Pattern:
 *   → right legSpacing
 *   ↑ up legSpacing
 *   ← left 2×legSpacing
 *   ↓ down 2×legSpacing
 *   → right 3×legSpacing
 *   ↑ up 3×legSpacing
 *   ...
 */
export function generateExpandingSquare(config: ExpandingSquareConfig): PatternResult {
  const { center, legSpacing, maxLegs, altitude, speed, startBearing } = config;
  const waypoints: PatternResult["waypoints"] = [];

  // Start at datum
  let currentLat = center[0];
  let currentLon = center[1];

  waypoints.push({
    lat: currentLat,
    lon: currentLon,
    alt: altitude,
    speed,
    command: "WAYPOINT",
  });

  let legLength = legSpacing;
  let bearing = startBearing;
  let legsAtCurrentLength = 0;

  for (let leg = 0; leg < maxLegs; leg++) {
    // Move along current bearing for legLength
    const dest = offsetPoint(currentLat, currentLon, bearing, legLength);
    currentLat = dest[0];
    currentLon = dest[1];

    waypoints.push({
      lat: currentLat,
      lon: currentLon,
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // Turn 90 degrees clockwise
    bearing = (bearing + 90) % 360;
    legsAtCurrentLength++;

    // Every 2 legs, increase the leg length
    if (legsAtCurrentLength === 2) {
      legLength += legSpacing;
      legsAtCurrentLength = 0;
    }
  }

  const stats = computeStats(waypoints, speed, 0);

  return {
    waypoints,
    stats,
  };
}

// ── Sector Search ─────────────────────────────────────────────

/**
 * Generate a sector search pattern.
 * The aircraft flies outward from datum, turns, flies back through datum,
 * and repeats at angular offsets. Creates a pie-slice coverage pattern.
 *
 * Standard sector search: 3 sweeps at 120° spacing covers the area around datum.
 */
export function generateSectorSearch(config: SectorSearchConfig): PatternResult {
  const { center, radius, sweeps, altitude, speed, startBearing } = config;
  const waypoints: PatternResult["waypoints"] = [];
  const angleStep = 360 / (sweeps * 2); // Angular spacing between outbound legs

  // Start at datum
  waypoints.push({
    lat: center[0],
    lon: center[1],
    alt: altitude,
    speed,
    command: "WAYPOINT",
  });

  for (let i = 0; i < sweeps; i++) {
    const outboundBearing = (startBearing + i * (360 / sweeps)) % 360;

    // Fly outward to radius
    const outbound = offsetPoint(center[0], center[1], outboundBearing, radius);
    waypoints.push({
      lat: outbound[0],
      lon: outbound[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // Turn and fly to offset point at radius
    const returnBearing = (outboundBearing + angleStep) % 360;
    const offsetPt = offsetPoint(center[0], center[1], returnBearing, radius);
    waypoints.push({
      lat: offsetPt[0],
      lon: offsetPt[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    // Return to datum
    waypoints.push({
      lat: center[0],
      lon: center[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });
  }

  const stats = computeStats(waypoints, speed, 0);

  return {
    waypoints,
    stats,
  };
}

// ── Parallel Track ────────────────────────────────────────────

/**
 * Generate a parallel track search pattern.
 * Similar to a survey grid but optimized for visual search:
 * - Tracks are aligned to a given bearing
 * - Spacing based on visual detection range, not camera overlap
 * - No camera trigger commands
 */
export function generateParallelTrack(config: ParallelTrackConfig): PatternResult {
  const { startPoint, trackLength, trackSpacing, trackCount, bearing, altitude, speed } = config;
  const waypoints: PatternResult["waypoints"] = [];

  // Perpendicular bearing for spacing between tracks
  const perpBearing = (bearing + 90) % 360;

  for (let i = 0; i < trackCount; i++) {
    // Offset start point perpendicular to track bearing
    const trackStart = offsetPoint(startPoint[0], startPoint[1], perpBearing, i * trackSpacing);

    // Alternate direction: even tracks go forward, odd tracks go backward
    const isReverse = i % 2 === 1;
    const trackBearing = isReverse ? (bearing + 180) % 360 : bearing;

    const start = isReverse
      ? offsetPoint(trackStart[0], trackStart[1], bearing, trackLength)
      : trackStart;

    const end = offsetPoint(start[0], start[1], trackBearing, trackLength);

    waypoints.push({
      lat: start[0],
      lon: start[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    waypoints.push({
      lat: end[0],
      lon: end[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });
  }

  const stats = computeStats(waypoints, speed, 0);

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
): PatternStats {
  let totalDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalDistance += haversineDistance(
      waypoints[i - 1].lat,
      waypoints[i - 1].lon,
      waypoints[i].lat,
      waypoints[i].lon,
    );
  }
  return {
    totalDistance,
    estimatedTime: speed > 0 ? totalDistance / speed : 0,
    photoCount: triggerDistance > 0 ? Math.ceil(totalDistance / triggerDistance) : 0,
    coveredArea: 0, // SAR patterns don't have a neat area calculation
    transectCount: Math.ceil(waypoints.length / 2),
  };
}
