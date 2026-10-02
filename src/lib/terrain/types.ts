/**
 * @module terrain/types
 * @description Types for terrain elevation data and terrain-following profiles.
 * @license GPL-3.0-only
 */

/** A single point along a terrain profile with position and elevation. */
export interface TerrainPoint {
  lat: number;
  lon: number;
  distance: number;    // meters from path start
  elevation: number;   // meters MSL
}

/**
 * One elevation sample along a path. `elevation` is `null` when the lookup
 * failed — distinct from a real 0 m sea-level reading, which is a valid value.
 */
export interface PathElevationSample {
  lat: number;
  lon: number;
  /** Meters from path start. */
  distance: number;
  /** Meters MSL, or `null` when the elevation is unknown. */
  elevation: number | null;
}

/** A stretch of the path whose terrain lookup failed: unknown, never clear. */
export interface TerrainGap {
  /** Distance (m) of the last known sample before the gap (or the first unknown one). */
  startDistance: number;
  /** Distance (m) of the first known sample after the gap (or the last unknown one). */
  endDistance: number;
}

/** A complete terrain elevation profile along a waypoint path. */
export interface TerrainProfile {
  /** The samples whose elevation resolved, in path order. */
  points: TerrainPoint[];
  /**
   * Stretches with no terrain data. A ridge inside one is invisible, so the
   * clearance there is unchecked; callers must not interpolate across it as if
   * the ground were known.
   */
  gaps: TerrainGap[];
  minElevation: number;
  maxElevation: number;
}
