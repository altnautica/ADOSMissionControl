/**
 * @module mission/mission-verify
 * @description Compares a mission list sent to a vehicle with the list read
 * back from it after the upload: same commands, frames and parameters;
 * positions within one 1e-7 degree unit and altitudes to the centimetre. An
 * acknowledged upload is only trusted once its read-back matches.
 *
 * ArduPilot does not echo items byte for byte. It stores each command in its
 * own compact form and rebuilds the item from a zeroed packet on download
 * (`AP_Mission::mission_cmd_to_mavlink_int`): only the parameters a command
 * keeps come back, a position and frame only for the commands stored with a
 * location, and `MAV_FRAME_MISSION` is read as an absolute (`GLOBAL`) datum.
 * The comparison follows those rules so a normal upload is not reported as
 * different from what was sent.
 * @license GPL-3.0-only
 */

import type { FirmwareType, MissionItem } from "@/lib/protocol/types";

const POSITION_UNITS = 1;
const ALT_TOLERANCE_M = 0.01;
// Parameters travel as float32: allow its rounding, no more.
const PARAM_TOLERANCE = 1e-4;

const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_MISSION = 2;

/** A vehicle may echo a global frame as its `_INT` twin; both mean the same datum. */
const INT_FRAME: Record<number, number> = { 0: 5, 3: 6, 10: 11 };

/** The item slots a stored command keeps. */
interface Kept {
  /** Indexes 1..4 of param1..param4 the vehicle echoes. */
  params: readonly number[];
  /** Stored with a location: x/y/z and the frame come back. */
  location?: boolean;
  /** x/y/z carried as plain parameters (no location). */
  xyz?: readonly ("x" | "y" | "z")[];
}

/**
 * What ArduPilot keeps per MAV_CMD (`AP_Mission::mission_cmd_to_mavlink_int`
 * and `stored_in_location`). A command not listed is compared in full.
 * NAV_WAYPOINT differs by vehicle and is resolved in `arduPilotKept`.
 */
const ARDUPILOT_KEPT: Record<number, Kept> = {
  16: { params: [1], location: true }, // NAV_WAYPOINT (Plane: see arduPilotKept)
  17: { params: [3], location: true }, // NAV_LOITER_UNLIM
  18: { params: [1, 3, 4], location: true }, // NAV_LOITER_TURNS
  19: { params: [1, 4], location: true }, // NAV_LOITER_TIME (param3 echoes only the turn direction)
  20: { params: [] }, // NAV_RETURN_TO_LAUNCH
  21: { params: [1], location: true }, // NAV_LAND (param4 echoes only the deepstall yaw direction)
  22: { params: [1], location: true }, // NAV_TAKEOFF
  30: { params: [1], location: true }, // NAV_CONTINUE_AND_CHANGE_ALT
  31: { params: [2], location: true }, // NAV_LOITER_TO_ALT (param4 echoes only the cross-track flag)
  82: { params: [1], location: true }, // NAV_SPLINE_WAYPOINT
  84: { params: [], location: true }, // NAV_VTOL_TAKEOFF
  85: { params: [1], location: true }, // NAV_VTOL_LAND
  92: { params: [1], location: true }, // NAV_GUIDED_ENABLE
  93: { params: [1, 2, 3, 4] }, // NAV_DELAY
  94: { params: [1], location: true }, // NAV_PAYLOAD_PLACE
  112: { params: [1] }, // CONDITION_DELAY
  114: { params: [1] }, // CONDITION_DISTANCE
  115: { params: [1, 2, 3, 4] }, // CONDITION_YAW
  177: { params: [1, 2] }, // DO_JUMP
  178: { params: [1, 2, 3] }, // DO_CHANGE_SPEED
  179: { params: [1], location: true }, // DO_SET_HOME
  181: { params: [1, 2] }, // DO_SET_RELAY
  183: { params: [1, 2] }, // DO_SET_SERVO
  189: { params: [], location: true }, // DO_LAND_START
  191: { params: [], location: true }, // DO_GO_AROUND
  195: { params: [1], location: true }, // DO_SET_ROI_LOCATION
  197: { params: [1] }, // DO_SET_ROI_NONE
  201: { params: [1], location: true }, // DO_SET_ROI
  203: { params: [1, 2, 3, 4], xyz: ["x", "y"] }, // DO_DIGICAM_CONTROL
  205: { params: [1, 2, 3] }, // DO_MOUNT_CONTROL (z echoes a fixed mount mode)
  206: { params: [1, 3, 4] }, // DO_SET_CAM_TRIGG_DIST
  207: { params: [1] }, // DO_FENCE_ENABLE
  211: { params: [1, 2] }, // DO_GRIPPER
  218: { params: [1, 2] }, // DO_AUX_FUNCTION
  3000: { params: [1] }, // DO_VTOL_TRANSITION
  2000: { params: [1, 2, 3, 4] }, // IMAGE_START_CAPTURE
  2001: { params: [1] }, // IMAGE_STOP_CAPTURE
  2500: { params: [1, 2, 3] }, // VIDEO_START_CAPTURE
  2501: { params: [1, 2] }, // VIDEO_STOP_CAPTURE
  42600: { params: [1, 2, 3, 4] }, // DO_WINCH
};

/** Plane keeps a waypoint's acceptance radius and pass-by distance, not a delay. */
const PLANE_WAYPOINT: Kept = { params: [2, 3], location: true };

function arduPilotKept(command: number, firmware: FirmwareType): Kept | undefined {
  if (command === 16 && firmware === "ardupilot-plane") return PLANE_WAYPOINT;
  return ARDUPILOT_KEPT[command];
}

/** Equal within `tolerance`; an unset (NaN) value sent may come back as 0. */
function close(sent: number, echoed: number, tolerance: number): boolean {
  if (Number.isNaN(sent)) return Number.isNaN(echoed) || echoed === 0;
  return Math.abs(sent - echoed) <= tolerance;
}

function sameFrame(sent: number, echoed: number, missionIsGlobal: boolean): boolean {
  const norm = (frame: number) => {
    const datum = missionIsGlobal && frame === MAV_FRAME_MISSION ? MAV_FRAME_GLOBAL : frame;
    return INT_FRAME[datum] ?? datum;
  };
  return norm(sent) === norm(echoed);
}

const PARAM_KEYS = ["param1", "param2", "param3", "param4"] as const;

/**
 * ArduPilot stores a location altitude as whole centimetres, truncated from
 * the float32 product (`location.alt = packet.z * 100.0f` into an int32), and
 * echoes those centimetres back: compare in its units.
 */
function arduPilotAltCm(sent: number): number {
  return Math.trunc(Math.fround(Math.fround(sent) * 100));
}

function sameArduPilotAlt(sent: number, echoed: number): boolean {
  if (Number.isNaN(sent)) return Number.isNaN(echoed) || echoed === 0;
  return arduPilotAltCm(sent) === Math.round(echoed * 100);
}

/**
 * The item an ArduPilot vehicle echoes for an uploaded `item`: a location
 * command's altitude comes back as its whole stored centimetres. Other slots
 * are left as sent.
 */
export function arduPilotStoredItem(item: MissionItem): MissionItem {
  if (!ARDUPILOT_KEPT[item.command]?.location) return { ...item };
  const z = Number.isNaN(item.z) ? 0 : Math.fround(arduPilotAltCm(item.z) * Math.fround(0.01));
  return { ...item, z };
}

function samePosition(a: MissionItem, b: MissionItem, arduPilot: boolean): boolean {
  return (
    Math.abs(a.x - b.x) <= POSITION_UNITS &&
    Math.abs(a.y - b.y) <= POSITION_UNITS &&
    (arduPilot ? sameArduPilotAlt(a.z, b.z) : close(a.z, b.z, ALT_TOLERANCE_M))
  );
}

function sameItem(a: MissionItem, b: MissionItem, firmware: FirmwareType | undefined): boolean {
  if (a.command !== b.command) return false;
  const arduPilot = firmware?.startsWith("ardupilot-") ?? false;
  const kept = arduPilot && firmware ? arduPilotKept(a.command, firmware) : undefined;
  if (!kept) {
    return (
      sameFrame(a.frame, b.frame, arduPilot) &&
      PARAM_KEYS.every((key) => close(a[key], b[key], PARAM_TOLERANCE)) &&
      samePosition(a, b, false)
    );
  }
  if (!kept.params.every((i) => close(a[PARAM_KEYS[i - 1]], b[PARAM_KEYS[i - 1]], PARAM_TOLERANCE))) {
    return false;
  }
  if (kept.location) return sameFrame(a.frame, b.frame, true) && samePosition(a, b, true);
  return (kept.xyz ?? []).every((key) => close(a[key], b[key], PARAM_TOLERANCE));
}

/**
 * True when `readBack` holds what `sent` asked for, read the way `firmware`
 * stores a mission. On ArduPilot seq 0 is home, which the vehicle fills from
 * its own position, so it is compared by count only.
 */
export function missionReadBackMatches(
  sent: readonly MissionItem[],
  readBack: readonly MissionItem[],
  firmware: FirmwareType | undefined,
): boolean {
  if (sent.length !== readBack.length) return false;
  const homeSlot = firmware?.startsWith("ardupilot-") ?? false;
  const bySeq = new Map(readBack.map((item) => [item.seq, item]));
  for (const item of sent) {
    if (homeSlot && item.seq === 0) continue;
    const echoed = bySeq.get(item.seq);
    if (!echoed || !sameItem(item, echoed, firmware)) return false;
  }
  return true;
}
