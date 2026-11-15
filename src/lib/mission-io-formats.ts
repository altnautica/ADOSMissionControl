/**
 * @module mission-io-formats
 * @description Import/export for .waypoints and .plan file formats.
 *
 * Both flat formats serialize the SAME `MissionItem[]` the MAVLink uploader
 * sends, produced by {@link expandToItems} and read back by
 * {@link collapseFromItems}. That is deliberate and load-bearing: these formats
 * carry raw MAVLink parameter slots, so a second slot mapping here is a second
 * source of truth, and the two used to disagree — a nav row's `param1` landed
 * in wire slot 2 from one path and slot 3 from the other, and an action's
 * `param4` was written as a hardcoded `0`. Everything about how the model maps
 * onto wire parameter slots lives in `mission/mission-expand`; this module only
 * knows how to write those items as text.
 *
 * NaN parameters ("use the vehicle's current value", e.g. a waypoint with no
 * heading) and `autocontinue = 0` are carried both ways: `.waypoints` writes
 * the literal `NaN`, `.plan` writes JSON `null`. Both formats carry the plan's
 * planned home, and `.plan` its autopilot and vehicle type, which the parsers
 * return as `settings`.
 *
 * @license GPL-3.0-only
 */

import type {
  Waypoint,
  AltitudeFrame,
  PlanVehicleProfile,
  PlannedHome,
  PlanSettings,
  PlanPlaceClass,
} from "@/lib/types";
import type { MissionItem } from "@/lib/protocol/types/mission";
import type { GeofenceSnapshot, FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import { cmdMap } from "@/lib/mission/command-map";
import {
  geofenceToQGC,
  parseQGCGeoFence,
  parseQGCRally,
  rallyToQGC,
} from "@/lib/mission/qgc-plan-extras";
import {
  expandToItems,
  collapseFromItems,
  itemCarriesLocation,
  missionCommandName,
} from "@/lib/mission/mission-expand";
import {
  DEFAULT_ALTITUDE_FRAME,
  frameToMav,
  mavToFrame,
} from "@/lib/mission/altitude-frame";
import { downloadBlob } from "@/lib/download";
import { DEFAULT_PLAN_PROFILE } from "@/lib/mission/plan-profile";
import { planLaunchPoint } from "@/lib/mission/plan-home";
import {
  assertAltitudes,
  attachLeadingItems,
  carriesAltitude,
  fileXY,
  plannedHomeFromFile,
  wireXY,
} from "@/lib/formats/mission-file-items";
import {
  QGC_ALT_MODE_MIXED,
  expandPlanItem,
  profileFromQGC,
  qgcAltitudeMode,
  qgcVehicleCodes,
  resolvePlanJumps,
  type PlanExpansion,
  type QGCPlanFile,
} from "@/lib/formats/qgc-plan-items";

/**
 * The altitude-frame ⇄ MAV_FRAME mapping lives in `mission/altitude-frame`
 * alongside the rest of the frame semantics. Re-exported here because
 * `frameToMav` is this module's long-standing public surface.
 */
export { frameToMav, mavToFrame };

/** Mission default frame applied when a waypoint carries no explicit frame. */
const DEFAULT_FRAME: AltitudeFrame = DEFAULT_ALTITUDE_FRAME;

// Both interop formats number the first mission item `1`: `.waypoints` writes
// the home position in row `0` (the ArduPilot layout) and `.plan` numbers
// `doJumpId` from 1 with the home in `plannedHomePosition`. The export expands
// with a reserved home slot, so rows and DO_JUMP targets carry that numbering
// straight from `expandToItems`.

/** What a flat-file export writes besides the waypoints. */
export interface FlatExportOptions {
  /** Mission default altitude frame for waypoints carrying none. */
  defaultFrame?: AltitudeFrame;
  /** Mission default ground speed (m/s) for waypoints carrying none. */
  defaultSpeed?: number;
  /** Autopilot and vehicle class the file is written for; absent = ArduPilot copter. */
  vehicle?: PlanVehicleProfile;
  /**
   * The plan's planned home, written into the file's home slot with its
   * ground elevation (0 when unknown). Absent: the plan's launch point stands
   * in at 0 m, as QGC and Mission Planner do before they know the home.
   */
  home?: PlannedHome;
  /** The place the plan flies in; `confined` is written into a `.plan` as
   *  `mission.placeClass`, open (the default) is omitted. */
  placeClass?: PlanPlaceClass;
}

/**
 * Expand one mission into file items: seq 0 is the home slot, the mission
 * starts at seq 1 and every DO_JUMP target is numbered to match.
 */
function toFileItems(waypoints: readonly Waypoint[], opts?: FlatExportOptions): MissionItem[] {
  const home: PlannedHome = opts?.home ?? planLaunchPoint(waypoints) ?? { lat: 0, lon: 0 };
  const vehicle = opts?.vehicle ?? DEFAULT_PLAN_PROFILE;
  return expandToItems(waypoints, {
    autopilot: vehicle.autopilot,
    vehicleClass: vehicle.vehicleClass,
    defaultFrame: opts?.defaultFrame ?? DEFAULT_FRAME,
    defaultSpeed: opts?.defaultSpeed,
    reserveHomeSlot: { lat: home.lat, lon: home.lon, alt: home.groundAmsl ?? 0 },
  });
}

/**
 * Collapse file items, naming every item that had no waypoint to ride.
 * Mission-start items written ahead of the first waypoint attach to it.
 * `autopilot`, when the file names it, decodes autopilot-specific commands.
 */
function collapseWithWarnings(
  items: readonly MissionItem[],
  home?: { lat: number; lon: number },
  autopilot?: PlanVehicleProfile["autopilot"],
): ParsedWaypoints {
  const warnings: string[] = [];
  const waypoints = collapseFromItems(
    attachLeadingItems(items),
    (dropped) => {
      warnings.push(droppedItemWarning(dropped));
    },
    home,
    autopilot,
  );
  return { waypoints, warnings };
}

/** Operator-facing note for an item dropped because it preceded every waypoint. */
export function droppedItemWarning(item: MissionItem): string {
  return `Dropped ${missionCommandName(item.command)} at item ${item.seq}: it comes before the first navigation waypoint`;
}

/** Waypoints parsed from a mission file plus any item that could not be kept. */
export interface ParsedWaypoints {
  waypoints: Waypoint[];
  warnings: string[];
  /** The planned home (and, for `.plan`, the vehicle profile) the file names. */
  settings?: PlanSettings;
}

/** `settings` holding only the fields a file named, or undefined when it named none. */
function fileSettings(
  plannedHome?: PlannedHome,
  vehicle?: PlanVehicleProfile,
  placeClass?: PlanPlaceClass,
): PlanSettings | undefined {
  const confined = placeClass === "confined";
  if (!plannedHome && !vehicle && !confined) return undefined;
  return {
    ...(plannedHome ? { plannedHome } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(confined ? { placeClass } : {}),
  };
}

// ── .waypoints Export (ArduPilot / Mission Planner format) ───

/**
 * Export waypoints as a `.waypoints` file (QGC WPL 110 format).
 * Tab-separated plain text compatible with Mission Planner and ArduPilot.
 *
 * Row 0 is the planned home the format mandates, flagged `current` as Mission
 * Planner writes it; rows 1..N are the mission items exactly as the MAVLink
 * uploader would send them. A NaN parameter is written as `NaN`.
 */
export function exportWaypointsFormat(
  waypoints: Waypoint[],
  name: string,
  opts?: FlatExportOptions,
): void {
  const items = toFileItems(waypoints, opts);

  const lines: string[] = ["QGC WPL 110"];
  for (const it of items) {
    const [x, y] = fileXY(it);
    lines.push(
      [
        it.seq, it.seq === 0 ? 1 : 0, it.frame, it.command,
        it.param1, it.param2, it.param3, it.param4,
        x, y, it.z, it.autocontinue,
      ].join("\t"),
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  downloadBlob(blob, `${name || "mission"}.waypoints`);
}

// ── .waypoints Import ────────────────────────────────────────

/**
 * A numeric column: `NaN`/`nan` (as Mission Planner and pymavlink write it) is
 * NaN, a number is itself, anything else is undefined for the caller to decide.
 */
function cell(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim();
  if (/^[+-]?nan$/i.test(text)) return Number.NaN;
  const v = Number.parseFloat(text);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Parse a `.waypoints` file into waypoints. Accepts `QGC WPL 110` (row 0 is the
 * planned home, returned in `settings`) and `QGC WPL 120` (no home row: row 0
 * is the first item and DO_JUMP targets shift by one); any other version is
 * refused, since its columns are laid out differently. `warnings` names every
 * item that was dropped. Throws on a flown item with no altitude.
 */
export function parseWaypointsFile(text: string): ParsedWaypoints {
  const lines = text.trim().split(/\r?\n/);
  const header = /^QGC WPL (\S+)$/.exec(lines[0]?.trim() ?? "");
  if (!header) {
    throw new Error("Invalid .waypoints file — missing QGC WPL header");
  }
  const version = header[1];
  if (version !== "110" && version !== "120") {
    throw new Error(`Unsupported waypoint file version ${version}`);
  }
  const hasHomeRow = version === "110";
  // Mission items are numbered from 1 here; a v120 file numbers them from 0.
  const shift = hasHomeRow ? 0 : 1;

  let home: PlannedHome | undefined;
  const items: MissionItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split("\t");
    if (cols.length < 12) continue;

    const fileSeq = cell(cols[0]) ?? items.length + 1 - shift;
    if (hasHomeRow && fileSeq === 0) {
      home = plannedHomeFromFile(cell(cols[8]) ?? Number.NaN, cell(cols[9]) ?? Number.NaN, cell(cols[10]) ?? Number.NaN);
      continue;
    }

    const command = cell(cols[3]) ?? cmdMap.WAYPOINT;
    const p5 = cell(cols[8]);
    const p6 = cell(cols[9]);
    // Skip malformed rows: a non-numeric lat/lon would otherwise create a
    // waypoint at NaN,NaN that renders nowhere and fails validation silently.
    if (itemCarriesLocation(command) && !(Number.isFinite(p5) && Number.isFinite(p6))) continue;

    const [x, y] = wireXY(command, p5 ?? 0, p6 ?? 0);
    const param1 = cell(cols[4]) ?? 0;
    items.push({
      seq: fileSeq + shift,
      current: 0,
      frame: cell(cols[2]) ?? frameToMav(DEFAULT_FRAME),
      command,
      param1: command === cmdMap.DO_JUMP ? param1 + shift : param1,
      param2: cell(cols[5]) ?? 0,
      param3: cell(cols[6]) ?? 0,
      param4: cell(cols[7]) ?? 0,
      x,
      y,
      // A flown item with an unreadable altitude stays NaN and is refused below.
      z: cell(cols[10]) ?? (carriesAltitude(command) ? Number.NaN : 0),
      autocontinue: cell(cols[11]) === 0 ? 0 : 1,
    });
  }
  assertAltitudes(items);

  // DO_JUMP targets resolve in the file's own sequence space (home = row 0);
  // the home places items that fly from where the vehicle is.
  const parsed = collapseWithWarnings(items, home);
  const settings = fileSettings(home);
  return settings ? { ...parsed, settings } : parsed;
}

// ── Extra plan payload (fence + rally) carried alongside waypoints ──

/** Optional fence + rally payload serialized into / parsed out of a `.plan`. */
export interface PlanExtras {
  geofence?: GeofenceSnapshot;
  rally?: RallyPoint[];
}

/** Result of parsing a `.plan` file: waypoints plus any fence / rally it carried. */
export interface ParsedPlan extends ParsedWaypoints {
  /** Fence geometry only; the importer merges it into the current fence settings. */
  fenceZones?: FenceZone[];
  rally?: RallyPoint[];
}

// ── .plan Export (QGroundControl JSON format) ────────────────

/**
 * Export waypoints as a `.plan` file (QGC JSON format). When `extras` carries a
 * geofence and/or rally points they are serialized into the geoFence and
 * rallyPoints blocks so the plan round-trips the full mission, not just the path.
 *
 * Items are the wire `MissionItem[]`, so `params[0..3]` are MAVLink `param1..4`.
 * An item with an altitude also carries QGC's `AltitudeMode` / `Altitude`, so
 * QGC shows a terrain-frame or relative waypoint as what it is rather than as
 * AMSL. The file names the autopilot and vehicle type it was planned for and
 * the mission speed.
 */
export function exportQGCPlan(
  waypoints: Waypoint[],
  name: string,
  extras?: PlanExtras,
  opts?: FlatExportOptions,
): void {
  // `.plan` keeps home in `plannedHomePosition`, so the home slot is not an item;
  // the mission items keep their 1-based seq as `doJumpId`.
  const [homeItem, ...wireItems] = toFileItems(waypoints, opts);
  const modes = new Set<number>();
  const items = wireItems.map((it) => {
    const [x, y] = fileXY(it);
    const mode = itemCarriesLocation(it.command) ? qgcAltitudeMode(it.frame) : undefined;
    if (mode !== undefined) modes.add(mode);
    return {
      // JSON.stringify writes a NaN parameter as `null`, which is how QGC stores NaN.
      ...(mode !== undefined ? { AltitudeMode: mode, Altitude: it.z, AMSLAltAboveTerrain: null } : {}),
      autoContinue: it.autocontinue === 1,
      command: it.command,
      doJumpId: it.seq,
      frame: it.frame,
      params: [it.param1, it.param2, it.param3, it.param4, x, y, it.z],
      type: "SimpleItem",
    };
  });
  const [onlyMode] = modes;
  const globalPlanAltitudeMode =
    modes.size === 1
      ? onlyMode
      : modes.size > 1
        ? QGC_ALT_MODE_MIXED
        : qgcAltitudeMode(frameToMav(opts?.defaultFrame ?? DEFAULT_FRAME)) ?? QGC_ALT_MODE_MIXED;
  const speed = opts?.defaultSpeed;

  const plan = {
    fileType: "Plan",
    groundStation: "Altnautica Command",
    version: 1,
    mission: {
      ...(speed !== undefined ? { cruiseSpeed: speed, hoverSpeed: speed } : {}),
      ...qgcVehicleCodes(opts?.vehicle ?? DEFAULT_PLAN_PROFILE),
      globalPlanAltitudeMode,
      items,
      plannedHomePosition: [homeItem.x / 1e7, homeItem.y / 1e7, homeItem.z],
      ...(opts?.placeClass === "confined" ? { placeClass: "confined" } : {}),
      version: 2,
    },
    geoFence: geofenceToQGC(extras?.geofence),
    rallyPoints: rallyToQGC(extras?.rally),
  };

  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${name || "mission"}.plan`);
}

// ── .plan Import ─────────────────────────────────────────────

/**
 * Parse a `.plan` (QGC JSON) file into waypoints plus any fence / rally it
 * carries, and the planned home and vehicle profile as `settings`. Survey /
 * corridor grids (ComplexItem) are expanded into waypoints; structure scans
 * and landing patterns are skipped with a warning; any other unexpandable
 * complex item throws. DO_JUMP targets follow the file's `doJumpId`
 * numbering, and the planned home places items that fly from home (a TAKEOFF
 * saved without a position). Throws on a flown item with no altitude.
 */
export function parseQGCPlan(text: string): ParsedPlan {
  const data = JSON.parse(text) as QGCPlanFile;
  if (data.fileType !== "Plan" || !data.mission?.items) {
    throw new Error("Invalid .plan file — missing Plan fileType or mission items");
  }

  const ctx: PlanExpansion = { jumpSeq: new Map(), warnings: [] };
  const expanded: MissionItem[] = [];
  for (const item of data.mission.items) {
    expandPlanItem(item, expanded, ctx);
  }
  const items = resolvePlanJumps(expanded, ctx);
  assertAltitudes(items);

  const position = data.mission.plannedHomePosition;
  const plannedHome = Array.isArray(position)
    ? plannedHomeFromFile(
        typeof position[0] === "number" ? position[0] : Number.NaN,
        typeof position[1] === "number" ? position[1] : Number.NaN,
        typeof position[2] === "number" ? position[2] : Number.NaN,
      )
    : undefined;
  const vehicle = profileFromQGC(data.mission.firmwareType, data.mission.vehicleType);
  const settings = fileSettings(plannedHome, vehicle, data.mission.placeClass === "confined" ? "confined" : undefined);

  // Collapse DO / CONDITION sibling items into their navigation waypoint's
  // actions, restoring each item's frame and every parameter slot.
  const { waypoints, warnings } = collapseWithWarnings(items, plannedHome, vehicle?.autopilot);
  return {
    waypoints,
    warnings: [...ctx.warnings, ...warnings],
    ...(settings ? { settings } : {}),
    fenceZones: parseQGCGeoFence(data.geoFence),
    rally: parseQGCRally(data.rallyPoints),
  };
}
