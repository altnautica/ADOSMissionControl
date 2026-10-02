/**
 * @module mission/sample-ground-elevations
 * @description Keep each waypoint's `groundElevation` matched to its position.
 *
 * `groundElevation` is derived from lat/lon: the mission store drops it
 * whenever an edit moves a waypoint (drag, nudge, typed coordinates, paste,
 * transforms, undo). The sync started here notices every waypoint without a
 * sample and looks up the terrain under it, in one batched request per store
 * change.
 *
 * Each request carries a per-waypoint token. A response is written only when
 * its token is still the newest one issued for that waypoint, and the store
 * re-checks that the waypoint still sits at the sampled position, so a slow
 * response for a position the waypoint has since left is discarded. Samples
 * are written outside the undo timeline: they are derived data, never an edit.
 *
 * A failed lookup leaves the waypoint unsampled (the validator reports its
 * terrain as unknown) and is not retried at that position until the sync
 * restarts, so an offline planner does not hammer the elevation service.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { getElevations } from "@/lib/terrain/terrain-provider";
import { useMissionStore, type GroundElevationSample } from "@/stores/mission-store";

/** Newest request token issued per waypoint id. */
const latestToken = new Map<string, number>();
/** Position (as `lat,lon`) last requested per waypoint id, pending or answered. */
const requestedAt = new Map<string, string>();
let tokenCounter = 0;

const positionKey = (wp: Waypoint): string => `${wp.lat},${wp.lon}`;

/**
 * Look up terrain under `waypoints` and write each sample that is still
 * current. Resolves once the samples have been applied (or dropped).
 */
export async function requestGroundElevations(waypoints: readonly Waypoint[]): Promise<void> {
  if (waypoints.length === 0) return;
  const requests = waypoints.map((wp) => {
    const token = ++tokenCounter;
    latestToken.set(wp.id, token);
    requestedAt.set(wp.id, positionKey(wp));
    return { id: wp.id, lat: wp.lat, lon: wp.lon, token };
  });
  let elevations: Array<number | null>;
  try {
    elevations = await getElevations(requests.map(({ lat, lon }) => ({ lat, lon })));
  } catch {
    return; // offline / API error — the validator reports the terrain unknown
  }
  const samples: GroundElevationSample[] = [];
  requests.forEach((req, i) => {
    if (latestToken.get(req.id) !== req.token) return; // superseded by a newer request
    latestToken.delete(req.id);
    const elevation = elevations[i];
    // `null` is a failed lookup: keep the position memo so it is not retried.
    // A real 0 m (sea level) sample is kept.
    if (elevation === null || elevation === undefined) return;
    requestedAt.delete(req.id);
    samples.push({ id: req.id, lat: req.lat, lon: req.lon, groundElevation: elevation });
  });
  useMissionStore.getState().applyGroundElevations(samples);
}

function sampleMissing(waypoints: readonly Waypoint[]): void {
  const live = new Set<string>();
  const missing: Waypoint[] = [];
  for (const wp of waypoints) {
    live.add(wp.id);
    if (wp.groundElevation !== undefined) continue;
    if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) continue;
    if (requestedAt.get(wp.id) === positionKey(wp)) continue;
    missing.push(wp);
  }
  // Forget waypoints that left the plan so their bookkeeping does not grow.
  for (const id of requestedAt.keys()) {
    if (!live.has(id)) {
      requestedAt.delete(id);
      latestToken.delete(id);
    }
  }
  if (missing.length > 0) void requestGroundElevations(missing);
}

/**
 * Sample terrain under every waypoint that has no sample, now and after every
 * change to the mission's waypoints. Returns the unsubscribe function.
 */
export function startGroundElevationSync(): () => void {
  // A fresh start retries positions whose earlier lookup failed.
  requestedAt.clear();
  sampleMissing(useMissionStore.getState().waypoints);
  return useMissionStore.subscribe((state, prev) => {
    if (state.waypoints !== prev.waypoints) sampleMissing(state.waypoints);
  });
}
