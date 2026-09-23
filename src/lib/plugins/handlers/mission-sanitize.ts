/**
 * Rebuild plugin-supplied waypoints into the planner's `Waypoint` shape.
 *
 * `mission.write` args arrive as `unknown` from a sandboxed iframe and flow
 * straight into `expandToItems` on upload, so every field that reaches the
 * encoder is copied from an allowlist and checked here: the command must be a
 * navigation command, the frame a known altitude frame, every action a known
 * action command, and every number finite. Fields outside the shape (and
 * `groundElevation`, which would let a plugin assert its own terrain height to
 * the clearance check) are dropped. A raw passthrough action is refused: a
 * plugin never gets to emit an arbitrary MAV_CMD through a mission.
 *
 * @module plugins/handlers/mission-sanitize
 * @license GPL-3.0-only
 */

import type {
  ActionCommand,
  AltitudeFrame,
  CommandMissionAction,
  NavCommand,
  Waypoint,
} from "@/lib/types";

const NAV_COMMANDS: Record<NavCommand, true> = {
  WAYPOINT: true, SPLINE_WAYPOINT: true, LOITER: true, LOITER_TIME: true,
  LOITER_TURNS: true, TAKEOFF: true, LAND: true, RTL: true,
  NAV_PAYLOAD_PLACE: true, VTOL_TAKEOFF: true, VTOL_LAND: true, DO_LAND_START: true,
};

const ACTION_COMMANDS: Record<ActionCommand, true> = {
  ROI: true, DO_SET_SPEED: true, DO_SET_CAM_TRIGG: true, DO_DIGICAM: true,
  DO_JUMP: true, DELAY: true, CONDITION_YAW: true, DO_SET_SERVO: true,
  DO_FENCE_ENABLE: true, DO_MOUNT_CONTROL: true, DO_GRIPPER: true, DO_WINCH: true,
  CONDITION_DISTANCE: true, DO_SET_HOME: true, DO_AUX_FUNCTION: true,
  DO_SET_ROI_NONE: true,
};

const FRAMES: Record<AltitudeFrame, true> = { relative: true, absolute: true, terrain: true };

const WAYPOINT_NUMBERS = ["speed", "holdTime", "param1", "param2", "param3"] as const;
const ACTION_NUMBERS = [
  "param1", "param2", "param3", "param4", "param5", "param6", "param7",
  "lat", "lon", "alt",
] as const;

export type SanitizeResult =
  | { ok: true; waypoints: Waypoint[] }
  | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function sanitizeAction(raw: unknown, where: string): CommandMissionAction | string {
  const a = asObject(raw);
  if (!a) return `${where}: action is not an object`;
  if (typeof a.id !== "string" || a.id.length === 0) return `${where}: action needs a string id`;
  if (typeof a.command !== "string" || !Object.hasOwn(ACTION_COMMANDS, a.command)) {
    return `${where}: action command ${String(a.command)} is not permitted`;
  }
  const out: CommandMissionAction = { id: a.id, command: a.command as ActionCommand };
  for (const key of ACTION_NUMBERS) {
    const v = a[key];
    if (v === undefined) continue;
    if (!isFiniteNumber(v)) return `${where}: action ${key} must be a finite number`;
    out[key] = v;
  }
  if (a.jumpTargetId !== undefined) {
    if (typeof a.jumpTargetId !== "string") return `${where}: jumpTargetId must be a string`;
    out.jumpTargetId = a.jumpTargetId;
  }
  return out;
}

/** Rebuild every waypoint, or name the first field that is not acceptable. */
export function sanitizePluginWaypoints(raw: unknown): SanitizeResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "payload.waypoints must be a non-empty array" };
  }
  const waypoints: Waypoint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const where = `waypoint ${i}`;
    const w = asObject(raw[i]);
    if (!w) return { ok: false, error: `${where} is not an object` };
    if (typeof w.id !== "string" || w.id.length === 0) {
      return { ok: false, error: `${where} needs a string id` };
    }
    if (!isFiniteNumber(w.lat) || !isFiniteNumber(w.lon) || !isFiniteNumber(w.alt)) {
      return { ok: false, error: `${where} needs finite lat, lon and alt` };
    }
    if (Math.abs(w.lat) > 90 || Math.abs(w.lon) > 180) {
      return { ok: false, error: `${where} coordinates are out of range` };
    }
    const wp: Waypoint = { id: w.id, lat: w.lat, lon: w.lon, alt: w.alt };
    if (w.command !== undefined) {
      if (typeof w.command !== "string" || !Object.hasOwn(NAV_COMMANDS, w.command)) {
        return { ok: false, error: `${where} command ${String(w.command)} is not permitted` };
      }
      wp.command = w.command as NavCommand;
    }
    if (w.frame !== undefined) {
      if (typeof w.frame !== "string" || !Object.hasOwn(FRAMES, w.frame)) {
        return { ok: false, error: `${where} frame ${String(w.frame)} is not an altitude frame` };
      }
      wp.frame = w.frame as AltitudeFrame;
    }
    for (const key of WAYPOINT_NUMBERS) {
      const v = w[key];
      if (v === undefined) continue;
      if (!isFiniteNumber(v)) return { ok: false, error: `${where} ${key} must be a finite number` };
      wp[key] = v;
    }
    if (w.actions !== undefined) {
      if (!Array.isArray(w.actions)) return { ok: false, error: `${where} actions must be an array` };
      const actions: CommandMissionAction[] = [];
      for (const rawAction of w.actions) {
        const action = sanitizeAction(rawAction, where);
        if (typeof action === "string") return { ok: false, error: action };
        actions.push(action);
      }
      if (actions.length > 0) wp.actions = actions;
    }
    waypoints.push(wp);
  }
  return { ok: true, waypoints };
}
