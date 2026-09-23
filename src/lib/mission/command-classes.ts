/**
 * Classification of mission commands into navigation vs action commands.
 *
 * A navigation command owns a physical waypoint (a real position the vehicle
 * flies to / through). An action command is a non-navigation command the flight
 * controller executes at or between waypoints; it attaches to the preceding NAV
 * waypoint and, on the wire, becomes its own mission item sequenced right after
 * that NAV item.
 *
 * The `_classified` record below is a compile-time exhaustiveness guard: every
 * `WaypointCommand` member must appear in it. A future command added to the
 * union that is not classified here breaks the build, forcing an explicit
 * nav-vs-action decision rather than a silent misclassification.
 *
 * @module mission/command-classes
 * @license GPL-3.0-only
 */

import type { ActionCommand, NavCommand, WaypointCommand } from "@/lib/types/mission";

/** Compile-time exhaustive nav-vs-action classification of every command. */
const _classified: Record<WaypointCommand, "nav" | "action"> = {
  // Navigation commands — each owns a physical waypoint.
  WAYPOINT: "nav",
  SPLINE_WAYPOINT: "nav",
  LOITER: "nav",
  LOITER_TIME: "nav",
  LOITER_TURNS: "nav",
  TAKEOFF: "nav",
  LAND: "nav",
  RTL: "nav",
  NAV_PAYLOAD_PLACE: "nav",
  VTOL_TAKEOFF: "nav",
  VTOL_LAND: "nav",
  DO_LAND_START: "nav",
  // Action commands — attach to the preceding NAV waypoint.
  ROI: "action",
  DO_SET_SPEED: "action",
  DO_SET_CAM_TRIGG: "action",
  DO_DIGICAM: "action",
  DO_JUMP: "action",
  DELAY: "action",
  CONDITION_YAW: "action",
  DO_SET_SERVO: "action",
  DO_FENCE_ENABLE: "action",
  DO_MOUNT_CONTROL: "action",
  DO_GRIPPER: "action",
  DO_WINCH: "action",
  CONDITION_DISTANCE: "action",
  DO_SET_HOME: "action",
  DO_AUX_FUNCTION: "action",
  DO_SET_ROI_NONE: "action",
};

/** All navigation commands (each owns a physical waypoint). */
export const NAV_COMMANDS: ReadonlySet<NavCommand> = new Set(
  (Object.keys(_classified) as WaypointCommand[]).filter(
    (c): c is NavCommand => _classified[c] === "nav",
  ),
);

/** All action commands (attach to the preceding NAV waypoint). */
export const ACTION_COMMANDS: ReadonlySet<ActionCommand> = new Set(
  (Object.keys(_classified) as WaypointCommand[]).filter(
    (c): c is ActionCommand => _classified[c] === "action",
  ),
);

/** Action commands whose own position (lat/lon/alt) rides in the item's x/y/z. */
export const POSITION_BEARING_ACTIONS: ReadonlySet<ActionCommand> = new Set<ActionCommand>([
  "ROI",
  "DO_SET_HOME",
]);

/**
 * MAV_CMD ids whose param5/param6 are a latitude/longitude (the commands the
 * MAVLink command definitions mark `hasLocation`). Used for commands this GCS
 * does not model: any other command's param5/param6 are plain numbers.
 */
export const LOCATION_MAV_CMDS: ReadonlySet<number> = new Set([
  16, 17, 18, 19, 21, 22, 23, 24, 31, 34, 35, 36, 80, 81, 82, 84, 85, 94,
  179, 188, 189, 192, 195, 201, 252, 611, 4001, 4501,
  5000, 5001, 5002, 5003, 5004, 5100, 30001, 43003,
  31000, 31001, 31002, 31003, 31004, 31005, 31006, 31007, 31008, 31009,
]);

/**
 * True when `c` is a navigation command. An undefined command defaults to
 * `WAYPOINT` (the wire default), which is a nav command, so `isNavCommand()`
 * returns `true`.
 */
export function isNavCommand(c?: WaypointCommand): boolean {
  return NAV_COMMANDS.has((c ?? "WAYPOINT") as NavCommand);
}

/**
 * True when `c` is an action command. An undefined command defaults to
 * `WAYPOINT`, so `isActionCommand()` returns `false`.
 */
export function isActionCommand(c?: WaypointCommand): boolean {
  return ACTION_COMMANDS.has((c ?? "WAYPOINT") as ActionCommand);
}
