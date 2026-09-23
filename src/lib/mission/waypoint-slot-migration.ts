/**
 * Upgrade stored waypoints to the current per-command slot layout.
 *
 * Two older shapes are rewritten:
 *
 * - An iNav row carried its action in a separate `inavAction` code and left
 *   `command` empty, so it uploaded as a plain WAYPOINT. The code now maps onto
 *   `command` (RTH → RTL, POSHOLD_UNLIM → LOITER, POSHOLD_TIME → LOITER_TIME,
 *   LAND → LAND). SET_POI / JUMP / SET_HEAD rows uploaded as WAYPOINT and stay
 *   WAYPOINT; their parameters had no effect and are cleared. A LAND row's site
 *   elevation moves to `param1`, the slot that reaches the iNav elevation field.
 * - The LOITER_TURNS editor stored turns in `param1` and radius in `param3`, and
 *   the PAYLOAD_PLACE editor stored max descent in `param1`. Those slots encode
 *   one MAVLink slot late. Turns and max descent move to `holdTime` (MAVLink
 *   param1) and the radius to `param2` (MAVLink param3). A waypoint collapsed
 *   from a download already has `holdTime` set and is left as it is.
 *
 * @module mission/waypoint-slot-migration
 * @license GPL-3.0-only
 */

import type { NavCommand, Waypoint } from "@/lib/types/mission";

/** iNav action code → navigation command, for the codes that have one. */
const INAV_ACTION_COMMAND: Record<number, NavCommand> = {
  1: "WAYPOINT",
  2: "LOITER",
  3: "LOITER_TIME",
  4: "RTL",
  8: "LAND",
};

/** iNav LAND action code. */
const INAV_ACTION_LAND = 8;

type StoredWaypoint = Waypoint & { inavAction?: number };

/** Rewrite one stored waypoint into the current slot layout. */
function migrateWaypoint(stored: StoredWaypoint): Waypoint {
  const { inavAction, ...wp } = stored;

  if (inavAction !== undefined && wp.command === undefined) {
    return {
      ...wp,
      command: INAV_ACTION_COMMAND[inavAction] ?? "WAYPOINT",
      param1: inavAction === INAV_ACTION_LAND ? wp.param2 : undefined,
      param2: undefined,
      param3: undefined,
    };
  }

  if (wp.command === "LOITER_TURNS" && wp.holdTime === undefined && wp.param2 === undefined) {
    return { ...wp, holdTime: wp.param1, param1: undefined, param2: wp.param3, param3: undefined };
  }

  if (wp.command === "NAV_PAYLOAD_PLACE" && wp.holdTime === undefined) {
    return { ...wp, holdTime: wp.param1, param1: undefined };
  }

  return wp;
}

/** Upgrade a stored waypoint list to the current per-command slot layout. */
export function migrateWaypointSlots(waypoints: readonly Waypoint[]): Waypoint[] {
  return waypoints.map((wp) => migrateWaypoint(wp as StoredWaypoint));
}
