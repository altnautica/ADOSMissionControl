/**
 * @module simulation/mission-action-state
 * @description Walks the per-waypoint `actions` a mission carries to derive
 * what the simulation draws for them: camera trigger points (DO_DIGICAM single
 * shots and DO_SET_CAM_TRIGG distance triggering) and, per leg, whether distance
 * triggering or a region of interest is active.
 *
 * The mission model keeps exactly one NAV command per `Waypoint` and folds the
 * action commands into `Waypoint.actions`. An action attached to waypoint `i`
 * runs on arrival there, so it governs the leg that starts at `i`.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/geo/distance";

/** A camera trigger position, with the altitude in the waypoints' own frame. */
export interface TriggerPoint {
  lat: number;
  lon: number;
  alt: number;
}

/** Action state in force on the leg that starts at a waypoint. */
export interface LegActionState {
  /** DO_SET_CAM_TRIGG distance triggering is on (distance > 0). */
  camTriggerActive: boolean;
  /** An ROI is set and has not been cleared by DO_SET_ROI_NONE. */
  roiActive: boolean;
}

/**
 * Camera trigger points for a mission. A DO_DIGICAM action fires one shot at
 * its waypoint; a DO_SET_CAM_TRIGG action with param1 > 0 fires every param1
 * metres along each following leg until a DO_SET_CAM_TRIGG with 0 stops it.
 */
export function computeTriggerPoints(waypoints: Waypoint[]): TriggerPoint[] {
  const points: TriggerPoint[] = [];
  let triggerDistance = 0;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];

    // The leg into this waypoint uses the distance set before arriving here.
    if (triggerDistance > 0 && i > 0) {
      const prev = waypoints[i - 1];
      const segDist = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
      const count = segDist > 0 ? Math.floor(segDist / triggerDistance) : 0;
      for (let t = 1; t <= count; t++) {
        const ratio = (t * triggerDistance) / segDist;
        points.push({
          lat: prev.lat + (wp.lat - prev.lat) * ratio,
          lon: prev.lon + (wp.lon - prev.lon) * ratio,
          alt: prev.alt + (wp.alt - prev.alt) * ratio,
        });
      }
    }

    for (const action of wp.actions ?? []) {
      if (action.command === "DO_SET_CAM_TRIGG") {
        const distance = action.param1 ?? 0;
        triggerDistance = Number.isFinite(distance) && distance > 0 ? distance : 0;
      } else if (action.command === "DO_DIGICAM") {
        points.push({ lat: wp.lat, lon: wp.lon, alt: wp.alt });
      }
    }
  }

  return points;
}

/**
 * The action state on the leg starting at each waypoint, after that waypoint's
 * own actions have run. Index `i` describes the leg from waypoint `i` to `i + 1`.
 */
export function legActionStates(waypoints: Waypoint[]): LegActionState[] {
  let camTriggerActive = false;
  let roiActive = false;
  return waypoints.map((wp) => {
    for (const action of wp.actions ?? []) {
      if (action.command === "DO_SET_CAM_TRIGG") {
        camTriggerActive = (action.param1 ?? 0) > 0;
      } else if (action.command === "ROI") {
        roiActive = true;
      } else if (action.command === "DO_SET_ROI_NONE") {
        roiActive = false;
      }
    }
    return { camTriggerActive, roiActive };
  });
}

/** True when any waypoint carries an action the path colouring depicts. */
export function hasDepictedActions(waypoints: Waypoint[]): boolean {
  return waypoints.some((wp) =>
    (wp.actions ?? []).some(
      (a) =>
        a.command === "DO_SET_CAM_TRIGG" ||
        a.command === "DO_DIGICAM" ||
        a.command === "ROI" ||
        a.command === "DO_SET_ROI_NONE",
    ),
  );
}
