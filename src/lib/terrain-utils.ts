/**
 * @module terrain-utils
 * @description Utilities for resolving AGL (Above Ground Level) waypoint altitudes
 * to absolute altitudes using CesiumJS terrain sampling. Adds intermediate
 * sub-sample points between waypoints for smooth terrain-following visualization.
 * @license GPL-3.0-only
 */

import {
  Cartographic,
  Cartesian3,
  sampleTerrainMostDetailed,
  type TerrainProvider,
} from "cesium";
import type { AltitudeFrame, Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/telemetry-utils";
import { loadGeoidGrid, mslToEllipsoidal } from "@/lib/terrain/geoid";
import { altitudeDatumFor } from "@/lib/mission/altitude-frame";

/** Spacing between intermediate sub-sample points (meters). */
const SUBSAMPLE_INTERVAL = 100;

/** Result of resolving AGL waypoints to absolute positions. */
export interface ResolvedPath {
  /** All positions along the path, including intermediate sub-samples. */
  positions: Cartesian3[];
  /** Indices into `positions` that correspond to original waypoints. */
  waypointIndices: number[];
  /** Terrain height (meters above ellipsoid) at each original waypoint. */
  terrainHeights: number[];
  /** Terrain height (meters above ellipsoid) at home, the relative-frame datum. */
  homeTerrainHeight: number;
}

/** Where relative-frame altitudes are measured from. */
export interface HomePoint {
  lat: number;
  lon: number;
}

/** A sampled terrain height, or a thrown error when the sample has none. */
function sampledHeight(carto: Cartographic | undefined): number {
  const h = carto?.height;
  if (typeof h !== "number" || !Number.isFinite(h)) {
    throw new Error("terrain sample returned no height");
  }
  return h;
}

/**
 * Resolve waypoint altitudes to absolute (ellipsoidal) positions for Cesium.
 * Adds intermediate sub-sample points every ~100m between waypoints so a
 * terrain-following leg is drawn against the real contour.
 *
 * FRAME-CORRECT, and this is the whole point of the function:
 *  - `absolute` carries an MSL/AMSL altitude, so it is placed at
 *    `mslToEllipsoidal(alt)` and terrain is NOT added — the same height
 *    regardless of the ground below.
 *  - `relative` is height above HOME, so it is placed at
 *    `homeTerrainHeight + alt`, with the terrain sampled at `home` (the
 *    vehicle's home when it has reported one, else the launch point the
 *    upload uses). It does NOT follow terrain. Drawing it as
 *    `terrainHeight + alt` hid every terrain conflict in the 3D view: the
 *    path was painted riding over each hill it would actually fly into.
 *  - `terrain` is height above the ground below the point, so it is
 *    `terrainHeight + alt` — the only frame that follows the contour.
 *
 * A waypoint without its own frame is in the mission default frame, the same
 * one the upload encodes it in. A segment's sub-samples inherit the frame of
 * its start waypoint. A terrain sample with no height makes the whole resolve
 * fail rather than placing that point at the ellipsoid. The geoid grid is
 * warmed here so the MSL conversion is correct on the first resolve (absent
 * grid -> honest MSL-as-ellipsoidal passthrough).
 */
export async function resolveAGLToAbsolute(
  waypoints: Waypoint[],
  terrainProvider: TerrainProvider,
  defaultFrame: AltitudeFrame,
  home: HomePoint,
): Promise<ResolvedPath> {
  if (waypoints.length === 0) {
    return { positions: [], waypointIndices: [], terrainHeights: [], homeTerrainHeight: 0 };
  }

  // Warm the bundled geoid grid so absolute-frame MSL->ellipsoidal is correct on
  // the first resolve. Cheap + cached + never throws; no-ops if the asset is
  // absent (then absolute frames pass through MSL unchanged).
  await loadGeoidGrid();

  // Build cartographic positions: original waypoints + intermediate points.
  // Track, per point, its geographic degrees, its altitude value, and the frame
  // that altitude is measured in.
  const cartographics: Cartographic[] = [];
  const lonLatDeg: Array<{ lat: number; lon: number }> = [];
  const altValues: number[] = [];
  const frames: AltitudeFrame[] = [];
  const waypointIndices: number[] = [];

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const frame: AltitudeFrame = wp.frame ?? defaultFrame;

    // Record this index as an original waypoint
    waypointIndices.push(cartographics.length);
    cartographics.push(Cartographic.fromDegrees(wp.lon, wp.lat));
    lonLatDeg.push({ lat: wp.lat, lon: wp.lon });
    altValues.push(wp.alt);
    frames.push(frame);

    // Add intermediate points to next waypoint for smooth terrain following
    if (i < waypoints.length - 1) {
      const next = waypoints[i + 1];
      const dist = haversineDistance(wp.lat, wp.lon, next.lat, next.lon);
      const numSub = Math.max(0, Math.floor(dist / SUBSAMPLE_INTERVAL) - 1);

      for (let s = 1; s <= numSub; s++) {
        const t = s / (numSub + 1);
        const lat = wp.lat + (next.lat - wp.lat) * t;
        const lon = wp.lon + (next.lon - wp.lon) * t;
        const alt = wp.alt + (next.alt - wp.alt) * t;

        cartographics.push(Cartographic.fromDegrees(lon, lat));
        lonLatDeg.push({ lat, lon });
        altValues.push(alt);
        frames.push(frame); // sub-samples inherit the segment's start frame
      }
    }
  }

  // Sample terrain at every point, plus home as the last sample.
  const sampled = await sampleTerrainMostDetailed(terrainProvider, [
    ...cartographics,
    Cartographic.fromDegrees(home.lon, home.lat),
  ]);

  // Home's terrain height is the datum every relative-frame altitude is
  // measured from. Everything here is in ellipsoidal height, so no geoid
  // conversion is needed for the two offset frames.
  const homeTerrainHeight = sampledHeight(sampled[cartographics.length]);

  const positions = cartographics.map((_, i) => {
    const carto = sampled[i];
    const { lat, lon } = lonLatDeg[i];
    let absoluteAlt: number;
    switch (altitudeDatumFor(frames[i])) {
      case "absolute":
        absoluteAlt = mslToEllipsoidal(altValues[i], lat, lon);
        break;
      case "home":
        absoluteAlt = homeTerrainHeight + altValues[i];
        break;
      case "waypointGround":
        absoluteAlt = sampledHeight(carto) + altValues[i];
        break;
    }
    return Cartesian3.fromRadians(carto.longitude, carto.latitude, absoluteAlt);
  });

  // Extract terrain heights at original waypoint positions only
  const terrainHeights = waypointIndices.map((idx) => sampledHeight(sampled[idx]));

  return { positions, waypointIndices, terrainHeights, homeTerrainHeight };
}
