/**
 * @module mission/sample-ground-elevations
 * @description Populate `groundElevation` for a batch of mission waypoints.
 *
 * Without a sample the terrain-clearance rule has nothing to compare, so every
 * generated mission (pattern apply, templates) samples terrain under all of
 * its waypoints in one batched lookup.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { getElevations } from "@/lib/terrain/terrain-provider";
import { useMissionStore } from "@/stores/mission-store";

/**
 * Fire-and-forget: look up terrain under every waypoint and write each sample
 * into the mission store. A failed lookup leaves that waypoint unsampled (the
 * validator reports it unchecked); a real 0 m sea-level sample is kept.
 */
export function sampleGroundElevations(waypoints: readonly Waypoint[]): void {
  if (waypoints.length === 0) return;
  const ids = waypoints.map((wp) => wp.id);
  getElevations(waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon })))
    .then((elevations) => {
      const store = useMissionStore.getState();
      for (let i = 0; i < ids.length; i++) {
        const elev = elevations[i];
        if (elev !== null) store.updateWaypoint(ids[i], { groundElevation: elev });
      }
    })
    .catch(() => { /* offline / API error — the validator reports it unchecked */ });
}
