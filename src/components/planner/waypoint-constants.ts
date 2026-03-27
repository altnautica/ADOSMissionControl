/**
 * @module waypoint-constants
 * @description Constants for WaypointListItem: command options, command letter map.
 * @license GPL-3.0-only
 */

import type { WaypointCommand } from "@/lib/types";

export const COMMAND_OPTIONS: { value: WaypointCommand; label: string }[] = [
  { value: "WAYPOINT", label: "Waypoint" },
  { value: "SPLINE_WAYPOINT", label: "Spline Waypoint" },
  { value: "TAKEOFF", label: "Takeoff" },
  { value: "LAND", label: "Land" },
  { value: "LOITER", label: "Loiter" },
  { value: "LOITER_TIME", label: "Loiter (Time)" },
  { value: "LOITER_TURNS", label: "Loiter (Turns)" },
  { value: "RTL", label: "Return to Launch" },
  { value: "ROI", label: "Region of Interest" },
  { value: "VTOL_TAKEOFF", label: "VTOL Takeoff" },
  { value: "VTOL_LAND", label: "VTOL Land" },
  { value: "NAV_PAYLOAD_PLACE", label: "Payload Place" },
  { value: "DO_SET_SPEED", label: "Set Speed" },
  { value: "DO_SET_CAM_TRIGG", label: "Camera Trigger" },
  { value: "DO_DIGICAM", label: "Camera Control" },
  { value: "DO_SET_SERVO", label: "Set Servo" },
  { value: "DO_MOUNT_CONTROL", label: "Gimbal Control" },
  { value: "DO_GRIPPER", label: "Gripper" },
  { value: "DO_WINCH", label: "Winch" },
  { value: "DO_FENCE_ENABLE", label: "Fence Enable/Disable" },
  { value: "DO_SET_HOME", label: "Set Home" },
  { value: "DO_AUX_FUNCTION", label: "Aux Function" },
  { value: "DO_JUMP", label: "Jump to WP" },
  { value: "DELAY", label: "Delay" },
  { value: "CONDITION_YAW", label: "Set Yaw" },
  { value: "CONDITION_DISTANCE", label: "Wait Distance" },
];

export const CMD_LETTER: Record<string, string> = {
  TAKEOFF: "T",
  WAYPOINT: "W",
  SPLINE_WAYPOINT: "S",
  LOITER: "L",
  LOITER_TIME: "L",
  LOITER_TURNS: "L",
  RTL: "R",
  LAND: "D",
  ROI: "O",
  NAV_PAYLOAD_PLACE: "P",
  DO_SET_SPEED: "S",
  DELAY: "Y",
  CONDITION_YAW: "Y",
  CONDITION_DISTANCE: "D",
  DO_SET_CAM_TRIGG: "C",
  DO_DIGICAM: "C",
  DO_JUMP: "J",
  DO_SET_SERVO: "V",
  DO_MOUNT_CONTROL: "G",
  DO_GRIPPER: "G",
  DO_WINCH: "N",
  DO_FENCE_ENABLE: "F",
  DO_SET_HOME: "H",
  DO_AUX_FUNCTION: "A",
  VTOL_TAKEOFF: "T",
  VTOL_LAND: "D",
};
