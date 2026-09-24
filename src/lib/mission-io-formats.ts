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
 * @license GPL-3.0-only
 */

import type { Waypoint, WaypointCommand, AltitudeFrame } from "@/lib/types";
import type { MissionItem } from "@/lib/protocol/types/mission";
import type { GeofenceSnapshot, FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import { cmdMap, reverseCmd } from "@/lib/mission/command-map";
import {
  geofenceToQGC,
  parseQGCGeoFence,
  parseQGCRally,
  rallyToQGC,
  type QGCGeoFence,
  type QGCRallyPoints,
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

/** Optional explicit home position written into a flat file's home slot. */
export interface FlatExportOptions {
  /** Mission default altitude frame for waypoints carrying none. */
  defaultFrame?: AltitudeFrame;
  /** Mission default ground speed (m/s) for waypoints carrying none. */
  defaultSpeed?: number;
  /**
   * The real home / launch position. When absent the first waypoint's
   * coordinates stand in as a PLANNED home at 0 m — a placeholder the format
   * requires, not a surveyed home.
   */
  home?: { lat: number; lon: number; alt?: number };
}

/** Parse a numeric column, falling back to `fallback` for a non-numeric cell. */
function num(raw: string | undefined, fallback: number): number {
  const v = Number.parseFloat(raw ?? "");
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Expand one mission into file items: seq 0 is the home slot, the mission
 * starts at seq 1 and every DO_JUMP target is numbered to match.
 */
function toFileItems(waypoints: readonly Waypoint[], opts?: FlatExportOptions): MissionItem[] {
  const home = opts?.home ?? { lat: waypoints[0]?.lat ?? 0, lon: waypoints[0]?.lon ?? 0, alt: 0 };
  return expandToItems(waypoints, {
    defaultFrame: opts?.defaultFrame ?? DEFAULT_FRAME,
    defaultSpeed: opts?.defaultSpeed,
    reserveHomeSlot: { lat: home.lat, lon: home.lon, alt: home.alt ?? 0 },
  });
}

/** Text-file value of an item's x/y: degrees for a location, else the raw parameter. */
function fileXY(item: MissionItem): [number, number] {
  return itemCarriesLocation(item.command) ? [item.x / 1e7, item.y / 1e7] : [item.x, item.y];
}

/** Wire x/y from a text-file param5/param6 pair (inverse of {@link fileXY}). */
function wireXY(command: number, p5: number, p6: number): [number, number] {
  return itemCarriesLocation(command)
    ? [Math.round(p5 * 1e7), Math.round(p6 * 1e7)]
    : [Math.round(p5), Math.round(p6)];
}

/** Collapse file items, naming every leading item that had no waypoint to ride. */
function collapseWithWarnings(items: readonly MissionItem[]): ParsedWaypoints {
  const warnings: string[] = [];
  const waypoints = collapseFromItems(items, (dropped) => {
    warnings.push(droppedItemWarning(dropped));
  });
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
}


// ── .waypoints Export (ArduPilot / Mission Planner format) ───

/**
 * Export waypoints as a `.waypoints` file (QGC WPL 110 format).
 * Tab-separated plain text compatible with Mission Planner and ArduPilot.
 *
 * Row 0 is the home position the format mandates; rows 1..N are the mission
 * items exactly as the MAVLink uploader would send them, so a nav waypoint's
 * parameters land in the same wire slots on disk as on the wire and an action's
 * `param4` is written rather than zeroed.
 */
export function exportWaypointsFormat(
  waypoints: Waypoint[],
  name: string,
  opts?: FlatExportOptions,
): void {
  // Row 0 is the home slot the format mandates; rows 1..N are the mission.
  const items = toFileItems(waypoints, opts);

  const lines: string[] = ["QGC WPL 110"];
  for (const it of items) {
    const [x, y] = fileXY(it);
    lines.push(
      [
        it.seq, it.current, it.frame, it.command,
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
 * Parse a `.waypoints` (QGC WPL 110) file into waypoints. `warnings` names
 * every item that was dropped because no navigation waypoint preceded it.
 */
export function parseWaypointsFile(text: string): ParsedWaypoints {
  const lines = text.trim().split("\n");
  if (!lines[0]?.startsWith("QGC WPL")) {
    throw new Error("Invalid .waypoints file — missing QGC WPL header");
  }

  const items: MissionItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split("\t");
    if (cols.length < 12) continue;

    // Row 0 is the home position, not a mission item; mission rows count from 1.
    const fileSeq = num(cols[0], items.length + 1);
    if (fileSeq === 0) continue;

    const p5 = Number.parseFloat(cols[8]);
    const p6 = Number.parseFloat(cols[9]);
    // Skip malformed rows: a non-numeric lat/lon would otherwise create a
    // waypoint at NaN,NaN that renders nowhere and fails validation silently.
    if (!Number.isFinite(p5) || !Number.isFinite(p6)) continue;

    const command = num(cols[3], cmdMap.WAYPOINT);
    const [x, y] = wireXY(command, p5, p6);
    items.push({
      seq: fileSeq,
      current: num(cols[1], 0),
      frame: num(cols[2], frameToMav(DEFAULT_FRAME)),
      command,
      // A legitimate 0 is a real parameter value, so parse then check
      // finiteness — `parseFloat(x) || 0` would be identical here but
      // `parseFloat(x) || undefined` (the old form) silently ate every zero.
      param1: num(cols[4], 0),
      param2: num(cols[5], 0),
      param3: num(cols[6], 0),
      param4: num(cols[7], 0),
      x,
      y,
      z: num(cols[10], 0),
      autocontinue: num(cols[11], 1),
    });
  }

  // Collapse the wire items back into nav waypoints with attached actions.
  // DO_JUMP targets resolve in the file's own sequence space (home = row 0).
  return collapseWithWarnings(items);
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
 * Items are the wire `MissionItem[]`, so `params[0..3]` are MAVLink `param1..4`
 * — including an action's `param4`, which used to be a hardcoded `0`.
 */
export function exportQGCPlan(
  waypoints: Waypoint[],
  name: string,
  metadata?: { cruiseSpeed?: number; vehicleType?: number },
  extras?: PlanExtras,
  opts?: FlatExportOptions,
): void {
  // `.plan` keeps home in `plannedHomePosition`, so the home slot is not an item;
  // the mission items keep their 1-based seq as `doJumpId`.
  const [homeItem, ...wireItems] = toFileItems(waypoints, opts);
  const home = { lat: homeItem.x / 1e7, lon: homeItem.y / 1e7, alt: homeItem.z };
  const items = wireItems.map((it) => {
    const [x, y] = fileXY(it);
    return {
      autoContinue: it.autocontinue === 1,
      command: it.command,
      doJumpId: it.seq,
      frame: it.frame,
      params: [it.param1, it.param2, it.param3, it.param4, x, y, it.z],
      type: "SimpleItem",
    };
  });

  const plan = {
    fileType: "Plan",
    groundStation: "Altnautica Command",
    version: 1,
    mission: {
      cruiseSpeed: metadata?.cruiseSpeed ?? 15,
      firmwareType: 3,
      items,
      plannedHomePosition: [home.lat, home.lon, home.alt ?? 0],
      vehicleType: metadata?.vehicleType ?? 2,
      version: 2,
    },
    geoFence: geofenceToQGC(extras?.geofence),
    rallyPoints: rallyToQGC(extras?.rally),
  };

  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${name || "mission"}.plan`);
}

// ── .plan Import ─────────────────────────────────────────────

/** Minimal typed views of the QGC .plan structures we read. */
interface QGCMissionItem {
  type?: string;
  command?: number;
  frame?: number;
  params?: number[];
  autoContinue?: boolean;
  complexItemType?: string;
  TransectStyleComplexItem?: QGCTransectStyle;
  // Present when the item itself is a TransectStyleComplexItem (transect fields inline).
  Items?: QGCMissionItem[];
  VisualTransectPoints?: Array<[number, number]>;
  CameraCalc?: QGCCameraCalc;
}

/**
 * Altitude and frame for waypoints rebuilt from a transect's visual points.
 * Throws when the file does not say how high to fly: a grid placed at 0 m
 * above home is a mission into the ground, not a default.
 */
function transectAltitude(calc: QGCCameraCalc | undefined, label: string): { z: number; frame: AltitudeFrame } {
  const z = calc?.DistanceToSurface;
  if (typeof z !== "number" || !Number.isFinite(z) || z <= 0) {
    throw new Error(`Cannot expand complex mission item "${label}" — no survey altitude (CameraCalc.DistanceToSurface) in the file`);
  }
  const mode = calc?.DistanceMode ?? (calc?.DistanceToSurfaceRelative === false ? 2 : 1);
  switch (mode) {
    case 1: return { z, frame: "relative" };
    case 2: return { z, frame: "absolute" };
    case 4: return { z, frame: "terrain" };
    default:
      // 3 = heights computed per point from terrain data the file does not carry.
      throw new Error(`Cannot expand complex mission item "${label}" — its altitude mode (${mode}) needs the embedded transect items`);
  }
}

interface QGCTransectStyle {
  Items?: QGCMissionItem[];
  VisualTransectPoints?: Array<[number, number]>;
  CameraCalc?: QGCCameraCalc;
}

/**
 * The survey's flight height. `DistanceMode` is QGC's AltitudeFrame
 * (1 relative, 2 absolute/AMSL, 3 calculated above terrain, 4 terrain frame);
 * files written before it carry `DistanceToSurfaceRelative` instead.
 */
interface QGCCameraCalc {
  DistanceToSurface?: number;
  DistanceMode?: number;
  DistanceToSurfaceRelative?: boolean;
}

interface QGCPlanFile {
  fileType?: string;
  mission?: { items?: QGCMissionItem[] };
  geoFence?: QGCGeoFence;
  rallyPoints?: QGCRallyPoints;
}

/**
 * Convert one QGC SimpleItem into a wire `MissionItem`. `params[0..3]` are
 * MAVLink `param1..4` verbatim — including a legitimate `0`, which the old
 * `params[n] || undefined` form silently discarded. `seq` is assigned by the
 * caller from row order so a `DO_JUMP`'s `doJumpId`-space target resolves.
 */
function simpleItemToWireItem(item: QGCMissionItem, seq: number): MissionItem {
  const params = item.params ?? [];
  const command = typeof item.command === "number" ? item.command : cmdMap.WAYPOINT;
  const [x, y] = wireXY(
    command,
    Number.isFinite(params[4]) ? params[4] : 0,
    Number.isFinite(params[5]) ? params[5] : 0,
  );
  return {
    seq,
    current: seq === 1 ? 1 : 0,
    frame: typeof item.frame === "number" ? item.frame : frameToMav(DEFAULT_FRAME),
    command,
    param1: Number.isFinite(params[0]) ? params[0] : 0,
    param2: Number.isFinite(params[1]) ? params[1] : 0,
    param3: Number.isFinite(params[2]) ? params[2] : 0,
    param4: Number.isFinite(params[3]) ? params[3] : 0,
    x,
    y,
    z: Number.isFinite(params[6]) ? params[6] : 0,
    autocontinue: item.autoContinue === false ? 0 : 1,
  };
}

/**
 * Expand a single mission item into wire items. SimpleItems map 1:1; a
 * ComplexItem / TransectStyleComplexItem (survey / corridor / structure grid)
 * is expanded from its embedded transect items or coordinates. A complex item
 * that carries no expandable geometry throws rather than being silently dropped.
 * Sequence numbers come from output position (from 1, the `doJumpId` numbering),
 * not the file, so an expanded grid does not collide with the surrounding items.
 */
function expandPlanItem(item: QGCMissionItem, out: MissionItem[]): void {
  if (item.type === "SimpleItem") {
    out.push(simpleItemToWireItem(item, out.length + 1));
    return;
  }

  if (item.type === "ComplexItem" || item.type === "TransectStyleComplexItem") {
    const transect =
      item.TransectStyleComplexItem ??
      (item.type === "TransectStyleComplexItem" ? item : undefined);

    const embedded = transect?.Items;
    if (Array.isArray(embedded) && embedded.length > 0) {
      for (const sub of embedded) expandPlanItem(sub, out);
      return;
    }

    const visual = transect?.VisualTransectPoints ?? item.VisualTransectPoints;
    if (Array.isArray(visual) && visual.length > 0) {
      const { z, frame } = transectAltitude(transect?.CameraCalc ?? item.CameraCalc, item.complexItemType ?? item.type ?? "ComplexItem");
      for (const pt of visual) {
        if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
          const seq = out.length + 1;
          out.push({
            seq,
            current: seq === 1 ? 1 : 0,
            frame: frameToMav(frame),
            command: cmdMap.WAYPOINT,
            param1: 0, param2: 0, param3: 0, param4: 0,
            x: Math.round(pt[0] * 1e7),
            y: Math.round(pt[1] * 1e7),
            z,
            autocontinue: 1,
          });
        }
      }
      return;
    }

    throw new Error(
      `Cannot expand complex mission item "${item.complexItemType ?? item.type}" — no embedded transect items or coordinates found`,
    );
  }

  // Unrecognized non-simple, non-complex item types are skipped.
}

/**
 * Parse a `.plan` (QGC JSON) file into waypoints plus any fence / rally it
 * carries. Survey / corridor / structure grids (ComplexItem) are expanded into
 * waypoints; an unexpandable complex item throws rather than dropping silently.
 */
export function parseQGCPlan(text: string): ParsedPlan {
  const data = JSON.parse(text) as QGCPlanFile;
  if (data.fileType !== "Plan" || !data.mission?.items) {
    throw new Error("Invalid .plan file — missing Plan fileType or mission items");
  }

  const items: MissionItem[] = [];
  for (const item of data.mission.items) {
    expandPlanItem(item, items);
  }

  // Collapse DO / CONDITION sibling items into their navigation waypoint's
  // actions, restoring each item's frame and every parameter slot.
  const { waypoints, warnings } = collapseWithWarnings(items);
  return {
    waypoints,
    warnings,
    fenceZones: parseQGCGeoFence(data.geoFence),
    rally: parseQGCRally(data.rallyPoints),
  };
}
