/**
 * @module patterns/pattern-to-mission
 * @description Turn a pattern generator's flat rows into mission waypoints.
 *
 * Generators emit one flat list that mixes navigation points with actions
 * (ROI, camera trigger). The mission model carries an action on the
 * navigation waypoint it follows, which is where the wire sequences it, so
 * each action folds onto the preceding navigation row. An action that comes
 * before every navigation row rides the first one. A TAKEOFF is added in front
 * when the pattern does not start with one, and an RTL is added at the end
 * unless the pattern already ends on the ground (LAND, VTOL_LAND) or with an
 * RTL.
 *
 * Every waypoint is stamped `relative` (above home), whatever the planner's
 * default frame: generator altitudes are heights above the launch ground (the
 * GSD and glide-slope math assume it), so writing them as `absolute` would put
 * a 60 m survey at 60 m above sea level and a LAND at 0 m MSL. A LAND row at
 * 0 m relative touches down at home ground level.
 *
 * Used by both the pattern apply and the mission templates, so the two always
 * produce the same mission for the same generator output.
 *
 * @license GPL-3.0-only
 */

import type {
  ActionCommand,
  AltitudeFrame,
  CommandMissionAction,
  Waypoint,
  WaypointCommand,
} from "@/lib/types";
import type { PatternWaypoint } from "./types";
import { isActionCommand, POSITION_BEARING_ACTIONS } from "@/lib/mission/command-classes";
import { randomId } from "@/lib/utils";

/** Navigation commands after which the mission needs no RTL. */
const MISSION_END_COMMANDS: ReadonlySet<WaypointCommand> = new Set<WaypointCommand>(["LAND", "VTOL_LAND", "RTL"]);

/** The frame generator altitudes are measured in: above home. */
export const PATTERN_ALTITUDE_FRAME: AltitudeFrame = "relative";

/**
 * Convert generator rows into a flyable mission. Returns an empty array when
 * the rows contain no navigation point.
 */
export function patternToMission(rows: readonly PatternWaypoint[]): Waypoint[] {
  const frame = PATTERN_ALTITUDE_FRAME;
  const waypoints: Waypoint[] = [];
  /** Actions seen before the first navigation row. */
  const leading: CommandMissionAction[] = [];

  for (const row of rows) {
    const command = (row.command || "WAYPOINT") as WaypointCommand;
    if (isActionCommand(command)) {
      const actionCommand = command as ActionCommand;
      const positional = POSITION_BEARING_ACTIONS.has(actionCommand);
      const action: CommandMissionAction = {
        id: randomId(),
        command: actionCommand,
        param1: row.param1,
        param2: row.param2,
        lat: positional ? row.lat : undefined,
        lon: positional ? row.lon : undefined,
        alt: positional ? row.alt : undefined,
      };
      const parent = waypoints[waypoints.length - 1];
      if (parent) parent.actions = [...(parent.actions ?? []), action];
      else leading.push(action);
      continue;
    }
    waypoints.push({
      id: randomId(),
      lat: row.lat,
      lon: row.lon,
      alt: row.alt,
      speed: row.speed,
      command,
      param1: row.param1,
      param2: row.param2,
      frame,
    });
  }
  if (waypoints.length === 0) return [];
  if (leading.length > 0) waypoints[0].actions = [...leading, ...(waypoints[0].actions ?? [])];

  const first = waypoints[0];
  if (first.command !== "TAKEOFF") {
    waypoints.unshift({ id: randomId(), lat: first.lat, lon: first.lon, alt: first.alt, command: "TAKEOFF", frame });
  }
  const last = waypoints[waypoints.length - 1];
  if (!MISSION_END_COMMANDS.has(last.command ?? "WAYPOINT")) {
    waypoints.push({ id: randomId(), lat: last.lat, lon: last.lon, alt: 0, command: "RTL", frame });
  }
  return waypoints;
}
