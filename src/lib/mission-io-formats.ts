/**
 * @module mission-io-formats
 * @description Import/export for .waypoints and .plan file formats.
 * @license GPL-3.0-only
 */

import type { Waypoint, WaypointCommand } from "@/lib/types";

/** MAVLink command string -> number mapping. */
export const cmdMap: Record<WaypointCommand, number> = {
  WAYPOINT: 16, SPLINE_WAYPOINT: 82, LOITER: 17, LOITER_TURNS: 18, LOITER_TIME: 19,
  RTL: 20, LAND: 21, TAKEOFF: 22, ROI: 201, DO_SET_SPEED: 178,
  DO_SET_CAM_TRIGG: 206, DO_DIGICAM: 203, DO_JUMP: 177, DELAY: 112,
  CONDITION_YAW: 115, DO_SET_SERVO: 183, DO_FENCE_ENABLE: 207,
  DO_MOUNT_CONTROL: 205, DO_GRIPPER: 211, DO_WINCH: 212,
  NAV_PAYLOAD_PLACE: 94, CONDITION_DISTANCE: 114, DO_SET_HOME: 179,
  DO_AUX_FUNCTION: 218, VTOL_TAKEOFF: 84, VTOL_LAND: 85,
  DO_SET_ROI_NONE: 197,
  DO_LAND_START: 189,
};

/** MAVLink command number -> string mapping. */
export const reverseCmd: Record<number, WaypointCommand> = Object.fromEntries(
  Object.entries(cmdMap).map(([k, v]) => [v, k as WaypointCommand])
) as Record<number, WaypointCommand>;

// ── .waypoints Export (ArduPilot / Mission Planner format) ───

/**
 * Export waypoints as a `.waypoints` file (QGC WPL 110 format).
 * Tab-separated plain text compatible with Mission Planner and ArduPilot.
 */
export function exportWaypointsFormat(waypoints: Waypoint[], name: string): void {
  const lines: string[] = ["QGC WPL 110"];

  const home = waypoints[0];
  lines.push(
    `0\t1\t0\t16\t0\t0\t0\t0\t${home?.lat ?? 0}\t${home?.lon ?? 0}\t0\t1`
  );

  waypoints.forEach((wp, i) => {
    const cmd = cmdMap[wp.command ?? "WAYPOINT"] ?? 16;
    const p1 = wp.holdTime ?? wp.param1 ?? 0;
    const p2 = wp.param2 ?? 0;
    const p3 = wp.param3 ?? 0;
    const p4 = 0;
    lines.push(
      `${i + 1}\t0\t3\t${cmd}\t${p1}\t${p2}\t${p3}\t${p4}\t${wp.lat}\t${wp.lon}\t${wp.alt}\t1`
    );
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name || "mission"}.waypoints`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── .waypoints Import ────────────────────────────────────────

/** Parse a `.waypoints` (QGC WPL 110) file into Waypoint array. */
export function parseWaypointsFile(text: string): Waypoint[] {
  const lines = text.trim().split("\n");
  if (!lines[0]?.startsWith("QGC WPL")) {
    throw new Error("Invalid .waypoints file — missing QGC WPL header");
  }

  const waypoints: Waypoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split("\t");
    if (cols.length < 12) continue;

    const seq = parseInt(cols[0]);
    if (seq === 0) continue;

    const cmdNum = parseInt(cols[3]);
    const command = reverseCmd[cmdNum] ?? "WAYPOINT";
    const lat = parseFloat(cols[8]);
    const lon = parseFloat(cols[9]);
    const alt = parseFloat(cols[10]);
    const p1 = parseFloat(cols[4]) || undefined;
    const p2 = parseFloat(cols[5]) || undefined;
    const p3 = parseFloat(cols[6]) || undefined;

    waypoints.push({
      id: Math.random().toString(36).substring(2, 10),
      lat, lon, alt,
      command,
      holdTime: (command === "LOITER" || command === "LOITER_TIME") ? p1 : undefined,
      param1: (command !== "LOITER" && command !== "LOITER_TIME") ? p1 : undefined,
      param2: p2,
      param3: p3,
    });
  }

  return waypoints;
}

// ── .plan Export (QGroundControl JSON format) ────────────────

/** Export waypoints as a `.plan` file (QGC JSON format). */
export function exportQGCPlan(
  waypoints: Waypoint[],
  name: string,
  metadata?: { cruiseSpeed?: number; vehicleType?: number }
): void {
  const home = waypoints[0];
  const items = waypoints.map((wp, i) => ({
    autoContinue: true,
    command: cmdMap[wp.command ?? "WAYPOINT"] ?? 16,
    doJumpId: i + 1,
    frame: 3,
    params: [
      wp.holdTime ?? wp.param1 ?? 0,
      wp.param2 ?? 0,
      wp.param3 ?? 0,
      0,
      wp.lat,
      wp.lon,
      wp.alt,
    ],
    type: "SimpleItem",
  }));

  const plan = {
    fileType: "Plan",
    groundStation: "Altnautica Command",
    version: 1,
    mission: {
      cruiseSpeed: metadata?.cruiseSpeed ?? 15,
      firmwareType: 3,
      items,
      plannedHomePosition: [home?.lat ?? 0, home?.lon ?? 0, 0],
      vehicleType: metadata?.vehicleType ?? 2,
      version: 2,
    },
    geoFence: { circles: [], polygons: [], version: 2 },
    rallyPoints: { points: [], version: 2 },
  };

  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name || "mission"}.plan`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── .plan Import ─────────────────────────────────────────────

/** Parse a `.plan` (QGC JSON) file into Waypoint array. */
export function parseQGCPlan(text: string): Waypoint[] {
  const data = JSON.parse(text);
  if (data.fileType !== "Plan" || !data.mission?.items) {
    throw new Error("Invalid .plan file — missing Plan fileType or mission items");
  }

  const waypoints: Waypoint[] = [];
  for (const item of data.mission.items) {
    if (item.type !== "SimpleItem") continue;

    const cmdNum = item.command ?? 16;
    const command = reverseCmd[cmdNum] ?? "WAYPOINT";
    const params = item.params ?? [];
    const lat = params[4] ?? 0;
    const lon = params[5] ?? 0;
    const alt = params[6] ?? 0;
    const p1 = params[0] || undefined;
    const p2 = params[1] || undefined;
    const p3 = params[2] || undefined;

    waypoints.push({
      id: Math.random().toString(36).substring(2, 10),
      lat, lon, alt,
      command,
      holdTime: (command === "LOITER" || command === "LOITER_TIME") ? p1 : undefined,
      param1: (command !== "LOITER" && command !== "LOITER_TIME") ? p1 : undefined,
      param2: p2,
      param3: p3,
    });
  }

  return waypoints;
}
