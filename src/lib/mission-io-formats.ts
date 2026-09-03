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
import { expandToItems, collapseFromItems } from "@/lib/mission/mission-expand";
import {
  DEFAULT_ALTITUDE_FRAME,
  frameToMav,
  mavToFrame,
} from "@/lib/mission/altitude-frame";

/**
 * The altitude-frame ⇄ MAV_FRAME mapping lives in `mission/altitude-frame`
 * alongside the rest of the frame semantics. Re-exported here because
 * `frameToMav` is this module's long-standing public surface.
 */
export { frameToMav, mavToFrame };

/** Mission default frame applied when a waypoint carries no explicit frame. */
const DEFAULT_FRAME: AltitudeFrame = DEFAULT_ALTITUDE_FRAME;

/**
 * Flat-file sequence numbering offset. Both interop formats number their first
 * mission item `1`: `.waypoints` reserves row `0` for the home position (the
 * ArduPilot convention) and `.plan` numbers `doJumpId` from 1. Our wire items
 * are 0-based, so the offset is applied to the row sequence AND to a `DO_JUMP`
 * target — which is a sequence number, not a user parameter, and would
 * otherwise point one item early in every exported file.
 */
const FILE_SEQ_OFFSET = 1;

/** Optional explicit home position written into a flat file's home slot. */
export interface FlatExportOptions {
  /** Mission default altitude frame for waypoints carrying none. */
  defaultFrame?: AltitudeFrame;
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
 * Apply the flat-file sequence offset to the wire items of one mission.
 * A `DO_JUMP`'s `param1` is a target sequence, so it shifts with the rows.
 */
function toFileItems(waypoints: readonly Waypoint[], defaultFrame: AltitudeFrame): MissionItem[] {
  return expandToItems(waypoints, { defaultFrame }).map((item) =>
    item.command === cmdMap.DO_JUMP
      ? { ...item, seq: item.seq + FILE_SEQ_OFFSET, param1: item.param1 + FILE_SEQ_OFFSET }
      : { ...item, seq: item.seq + FILE_SEQ_OFFSET },
  );
}

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
  const items = toFileItems(waypoints, opts?.defaultFrame ?? DEFAULT_FRAME);
  const home = opts?.home ?? { lat: waypoints[0]?.lat ?? 0, lon: waypoints[0]?.lon ?? 0, alt: 0 };

  const lines: string[] = ["QGC WPL 110"];
  lines.push(
    `0\t1\t0\t16\t0\t0\t0\t0\t${home.lat}\t${home.lon}\t${home.alt ?? 0}\t1`,
  );
  for (const it of items) {
    lines.push(
      [
        it.seq, it.current, it.frame, it.command,
        it.param1, it.param2, it.param3, it.param4,
        it.x / 1e7, it.y / 1e7, it.z, it.autocontinue,
      ].join("\t"),
    );
  }

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

  const items: MissionItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split("\t");
    if (cols.length < 12) continue;

    // Row 0 is the home position, not a mission item.
    const fileSeq = num(cols[0], items.length + FILE_SEQ_OFFSET);
    if (fileSeq === 0) continue;

    const lat = Number.parseFloat(cols[8]);
    const lon = Number.parseFloat(cols[9]);
    // Skip malformed rows: a non-numeric lat/lon would otherwise create a
    // waypoint at NaN,NaN that renders nowhere and fails validation silently.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    items.push({
      seq: fileSeq,
      current: num(cols[1], 0),
      frame: num(cols[2], frameToMav(DEFAULT_FRAME)),
      command: num(cols[3], cmdMap.WAYPOINT),
      // A legitimate 0 is a real parameter value, so parse then check
      // finiteness — `parseFloat(x) || 0` would be identical here but
      // `parseFloat(x) || undefined` (the old form) silently ate every zero.
      param1: num(cols[4], 0),
      param2: num(cols[5], 0),
      param3: num(cols[6], 0),
      param4: num(cols[7], 0),
      x: Math.round(lat * 1e7),
      y: Math.round(lon * 1e7),
      z: num(cols[10], 0),
      autocontinue: num(cols[11], 1),
    });
  }

  // Collapse the wire items back into nav waypoints with attached actions.
  // DO_JUMP targets resolve in the file's own sequence space, which is why the
  // export shifted them alongside the rows.
  return collapseFromItems(items);
}

// ── Extra plan payload (fence + rally) carried alongside waypoints ──

/** Optional fence + rally payload serialized into / parsed out of a `.plan`. */
export interface PlanExtras {
  geofence?: GeofenceSnapshot;
  rally?: RallyPoint[];
}

/** Result of parsing a `.plan` file: waypoints plus any fence / rally it carried. */
export interface ParsedPlan {
  waypoints: Waypoint[];
  geofence?: GeofenceSnapshot;
  rally?: RallyPoint[];
}

// ── .plan Export (QGroundControl JSON format) ────────────────

interface QGCFenceCircleEntry {
  inclusion: boolean;
  version: 1;
  circle: { center: [number, number]; radius: number };
}

interface QGCFencePolygonEntry {
  inclusion: boolean;
  version: 1;
  polygon: Array<[number, number]>;
}

/** Serialize the operator geofence into the .plan geoFence block. */
function geofenceToQGC(snapshot: GeofenceSnapshot | undefined): {
  circles: QGCFenceCircleEntry[];
  polygons: QGCFencePolygonEntry[];
  version: 2;
} {
  const circles: QGCFenceCircleEntry[] = [];
  const polygons: QGCFencePolygonEntry[] = [];

  if (snapshot) {
    // Multi-zone inclusion / exclusion fences.
    for (const z of snapshot.zones) {
      const inclusion = z.role === "inclusion";
      if (z.type === "circle" && z.circleCenter) {
        circles.push({
          inclusion,
          version: 1,
          circle: { center: [z.circleCenter[0], z.circleCenter[1]], radius: z.circleRadius },
        });
      } else if (z.type === "polygon" && z.polygonPoints.length >= 3) {
        polygons.push({
          inclusion,
          version: 1,
          polygon: z.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
        });
      }
    }

    // Legacy single top-level fence (inclusion by definition — must stay inside).
    if (snapshot.enabled) {
      if (snapshot.fenceType === "circle" && snapshot.circleCenter) {
        circles.push({
          inclusion: true,
          version: 1,
          circle: {
            center: [snapshot.circleCenter[0], snapshot.circleCenter[1]],
            radius: snapshot.circleRadius,
          },
        });
      } else if (snapshot.fenceType === "polygon" && snapshot.polygonPoints.length >= 3) {
        polygons.push({
          inclusion: true,
          version: 1,
          polygon: snapshot.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
        });
      }
    }
  }

  return { circles, polygons, version: 2 };
}

/** Serialize rally points into the .plan rallyPoints block ([lat, lon, alt] triples). */
function rallyToQGC(rally: RallyPoint[] | undefined): {
  points: Array<[number, number, number]>;
  version: 2;
} {
  const points: Array<[number, number, number]> = (rally ?? []).map((p) => [p.lat, p.lon, p.alt]);
  return { points, version: 2 };
}

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
  const wireItems = toFileItems(waypoints, opts?.defaultFrame ?? DEFAULT_FRAME);
  const home = opts?.home ?? { lat: waypoints[0]?.lat ?? 0, lon: waypoints[0]?.lon ?? 0, alt: 0 };
  const items = wireItems.map((it) => ({
    autoContinue: it.autocontinue === 1,
    command: it.command,
    doJumpId: it.seq,
    frame: it.frame,
    params: [it.param1, it.param2, it.param3, it.param4, it.x / 1e7, it.y / 1e7, it.z],
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
      plannedHomePosition: [home.lat, home.lon, home.alt ?? 0],
      vehicleType: metadata?.vehicleType ?? 2,
      version: 2,
    },
    geoFence: geofenceToQGC(extras?.geofence),
    rallyPoints: rallyToQGC(extras?.rally),
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
}

interface QGCTransectStyle {
  Items?: QGCMissionItem[];
  VisualTransectPoints?: Array<[number, number]>;
}

interface QGCGeoFence {
  circles?: Array<{ inclusion?: boolean; circle?: { center?: [number, number]; radius?: number } }>;
  polygons?: Array<{ inclusion?: boolean; polygon?: Array<[number, number]> }>;
}

interface QGCPlanFile {
  fileType?: string;
  mission?: { items?: QGCMissionItem[] };
  geoFence?: QGCGeoFence;
  rallyPoints?: { points?: Array<[number, number, number]> };
}

let importZoneCounter = 0;
function nextImportZoneId(): string {
  return `fence-import-${++importZoneCounter}`;
}

let importRallyCounter = 0;
function nextImportRallyId(): string {
  return `rally-import-${++importRallyCounter}`;
}

/**
 * Convert one QGC SimpleItem into a wire `MissionItem`. `params[0..3]` are
 * MAVLink `param1..4` verbatim — including a legitimate `0`, which the old
 * `params[n] || undefined` form silently discarded. `seq` is assigned by the
 * caller from row order so a `DO_JUMP`'s `doJumpId`-space target resolves.
 */
function simpleItemToWireItem(item: QGCMissionItem, seq: number): MissionItem {
  const params = item.params ?? [];
  const lat = Number.isFinite(params[4]) ? params[4] : 0;
  const lon = Number.isFinite(params[5]) ? params[5] : 0;
  return {
    seq,
    current: seq === FILE_SEQ_OFFSET ? 1 : 0,
    frame: typeof item.frame === "number" ? item.frame : frameToMav(DEFAULT_FRAME),
    command: typeof item.command === "number" ? item.command : cmdMap.WAYPOINT,
    param1: Number.isFinite(params[0]) ? params[0] : 0,
    param2: Number.isFinite(params[1]) ? params[1] : 0,
    param3: Number.isFinite(params[2]) ? params[2] : 0,
    param4: Number.isFinite(params[3]) ? params[3] : 0,
    x: Math.round(lat * 1e7),
    y: Math.round(lon * 1e7),
    z: Number.isFinite(params[6]) ? params[6] : 0,
    autocontinue: item.autoContinue === false ? 0 : 1,
  };
}

/**
 * Expand a single mission item into wire items. SimpleItems map 1:1; a
 * ComplexItem / TransectStyleComplexItem (survey / corridor / structure grid)
 * is expanded from its embedded transect items or coordinates. A complex item
 * that carries no expandable geometry throws rather than being silently dropped.
 * Sequence numbers come from output position, not the file, so an expanded grid
 * does not collide with the surrounding items.
 */
function expandPlanItem(item: QGCMissionItem, out: MissionItem[]): void {
  if (item.type === "SimpleItem") {
    out.push(simpleItemToWireItem(item, out.length + FILE_SEQ_OFFSET));
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
      for (const pt of visual) {
        if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
          const seq = out.length + FILE_SEQ_OFFSET;
          out.push({
            seq,
            current: seq === FILE_SEQ_OFFSET ? 1 : 0,
            frame: frameToMav(DEFAULT_FRAME),
            command: cmdMap.WAYPOINT,
            param1: 0, param2: 0, param3: 0, param4: 0,
            x: Math.round(pt[0] * 1e7),
            y: Math.round(pt[1] * 1e7),
            z: 0,
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

/** Parse the .plan geoFence block into a GeofenceSnapshot (inclusion / exclusion zones). */
function parseQGCGeoFence(geoFence: QGCGeoFence | undefined): GeofenceSnapshot | undefined {
  if (!geoFence) return undefined;

  const zones: FenceZone[] = [];

  for (const c of geoFence.circles ?? []) {
    const center = c?.circle?.center;
    const radius = c?.circle?.radius;
    if (
      Array.isArray(center) && center.length >= 2 &&
      Number.isFinite(center[0]) && Number.isFinite(center[1]) &&
      typeof radius === "number" && Number.isFinite(radius)
    ) {
      zones.push({
        id: nextImportZoneId(),
        role: c.inclusion === false ? "exclusion" : "inclusion",
        type: "circle",
        polygonPoints: [],
        circleCenter: [center[0], center[1]],
        circleRadius: radius,
      });
    }
  }

  for (const p of geoFence.polygons ?? []) {
    const poly = p?.polygon;
    if (Array.isArray(poly)) {
      const points = poly
        .filter((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
        .map((pt) => [pt[0], pt[1]] as [number, number]);
      if (points.length >= 3) {
        zones.push({
          id: nextImportZoneId(),
          role: p.inclusion === false ? "exclusion" : "inclusion",
          type: "polygon",
          polygonPoints: points,
          circleCenter: null,
          circleRadius: 0,
        });
      }
    }
  }

  if (zones.length === 0) return undefined;

  return {
    enabled: true,
    fenceType: zones[0].type,
    maxAltitude: 120,
    minAltitude: 0,
    breachAction: "RTL",
    circleCenter: null,
    circleRadius: 200,
    polygonPoints: [],
    zones,
  };
}

/** Parse the .plan rallyPoints block into RallyPoint[]. */
function parseQGCRally(rallyPoints: QGCPlanFile["rallyPoints"]): RallyPoint[] | undefined {
  const raw = rallyPoints?.points;
  if (!Array.isArray(raw)) return undefined;

  const points: RallyPoint[] = [];
  for (const pt of raw) {
    if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      const alt = pt[2];
      points.push({
        id: nextImportRallyId(),
        lat: pt[0],
        lon: pt[1],
        alt: typeof alt === "number" && Number.isFinite(alt) ? alt : 0,
      });
    }
  }

  return points.length > 0 ? points : undefined;
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

  return {
    // Collapse DO / CONDITION sibling items into their navigation waypoint's
    // actions, restoring each item's frame and every parameter slot.
    waypoints: collapseFromItems(items),
    geofence: parseQGCGeoFence(data.geoFence),
    rally: parseQGCRally(data.rallyPoints),
  };
}
