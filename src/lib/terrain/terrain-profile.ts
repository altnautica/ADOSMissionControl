/**
 * @module terrain/terrain-profile
 * @description Computes terrain elevation profiles along waypoint paths.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { TerrainProfile, TerrainPoint } from "./types";
import { getElevations } from "./terrain-provider";
import { haversineDistance } from "@/lib/telemetry-utils";

/**
 * Compute a terrain elevation profile along a waypoint path.
 * Samples elevation at each waypoint and at intermediate points between them.
 *
 * @param waypoints Waypoint array to profile
 * @param samplesPerSegment Number of intermediate samples between each waypoint pair
 * @param signal Optional AbortSignal for cancellation
 * @returns TerrainProfile with elevation data along the path, or `null` when the
 *   elevation data is unavailable (offline / every lookup failed) so callers can
 *   show an explicit "unavailable" state instead of a fabricated flat-0 profile.
 */
export async function computeTerrainProfile(
  waypoints: Waypoint[],
  samplesPerSegment = 10,
  signal?: AbortSignal,
): Promise<TerrainProfile | null> {
  if (waypoints.length === 0) {
    return { points: [], minElevation: 0, maxElevation: 0 };
  }

  // Build sample points: each waypoint + intermediate samples
  const samplePoints: Array<{ lat: number; lon: number; cumDist: number }> = [];
  let cumDist = 0;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];

    if (i > 0) {
      const prev = waypoints[i - 1];
      const segDist = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);

      // Add intermediate samples
      for (let s = 1; s <= samplesPerSegment; s++) {
        const t = s / (samplesPerSegment + 1);
        samplePoints.push({
          lat: prev.lat + (wp.lat - prev.lat) * t,
          lon: prev.lon + (wp.lon - prev.lon) * t,
          cumDist: cumDist + segDist * t,
        });
      }

      cumDist += segDist;
    }

    samplePoints.push({ lat: wp.lat, lon: wp.lon, cumDist });
  }

  // Sort by cumulative distance (intermediate points were inserted before their end waypoint)
  samplePoints.sort((a, b) => a.cumDist - b.cumDist);

  // Fetch elevations (null at any index whose lookup failed)
  const elevations = await getElevations(
    samplePoints.map((p) => ({ lat: p.lat, lon: p.lon })),
    signal,
  );

  // Build profile from the samples that actually resolved. If none did, the
  // terrain data is unavailable — return null so the chart shows an explicit
  // offline state rather than a false sea-level baseline.
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  const points: TerrainPoint[] = [];

  for (let i = 0; i < samplePoints.length; i++) {
    const elev = elevations[i];
    if (elev === null) continue;
    if (elev < minElevation) minElevation = elev;
    if (elev > maxElevation) maxElevation = elev;
    points.push({
      lat: samplePoints[i].lat,
      lon: samplePoints[i].lon,
      distance: samplePoints[i].cumDist,
      elevation: elev,
    });
  }

  if (points.length === 0) return null;

  return { points, minElevation, maxElevation };
}
