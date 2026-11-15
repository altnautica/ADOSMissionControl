/**
 * @module formats/qgc-plan-items
 * @description QGroundControl `.plan` mission items: the JSON shapes we read,
 * SimpleItem and complex-item expansion into wire `MissionItem`s, DO_JUMP
 * renumbering, and the firmware / vehicle type and altitude-mode codes QGC
 * writes alongside the items.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, PlanVehicleProfile, PlanVehicleClass } from "@/lib/types";
import type { MissionItem } from "@/lib/protocol/types/mission";
import type { QGCGeoFence, QGCRallyPoints } from "@/lib/mission/qgc-plan-extras";
import { cmdMap } from "@/lib/mission/command-map";
import { DEFAULT_ALTITUDE_FRAME, frameToMav } from "@/lib/mission/altitude-frame";
import { itemCarriesLocation } from "@/lib/mission/mission-expand";
import { carriesAltitude, wireXY } from "./mission-file-items";

/** Minimal typed view of a QGC .plan mission item. */
export interface QGCMissionItem {
  type?: string;
  command?: number;
  /** QGC's own item number; a DO_JUMP's `params[0]` names its target by it. */
  doJumpId?: number;
  frame?: number;
  /** MAVLink param1..7; `null` is QGC's encoding of NaN. */
  params?: Array<number | null>;
  autoContinue?: boolean;
  complexItemType?: string;
  TransectStyleComplexItem?: QGCTransectStyle;
  // Present when the item itself is a TransectStyleComplexItem (transect fields inline).
  Items?: QGCMissionItem[];
  VisualTransectPoints?: Array<[number, number]>;
  CameraCalc?: QGCCameraCalc;
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

export interface QGCPlanFile {
  fileType?: string;
  mission?: {
    items?: QGCMissionItem[];
    plannedHomePosition?: number[];
    firmwareType?: number;
    vehicleType?: number;
    /** The ADOS place class; `"confined"` when written, absent = open. */
    placeClass?: string;
  };
  geoFence?: QGCGeoFence;
  rallyPoints?: QGCRallyPoints;
}

// ── Firmware and vehicle type (MAV_AUTOPILOT / MAV_TYPE) ─────

/** MAV_AUTOPILOT written as `.plan` `firmwareType`. */
const FIRMWARE_TYPE: Record<PlanVehicleProfile["autopilot"], number> = { ardupilot: 3, px4: 12 };

/** MAV_TYPE written as `.plan` `vehicleType` (quadrotor, fixed wing, VTOL quad, ground rover). */
const VEHICLE_TYPE: Record<PlanVehicleClass, number> = { copter: 2, plane: 1, vtol: 20, rover: 10 };

/** QGC `firmwareType` / `vehicleType` for a plan profile. */
export function qgcVehicleCodes(profile: PlanVehicleProfile): { firmwareType: number; vehicleType: number } {
  return { firmwareType: FIRMWARE_TYPE[profile.autopilot], vehicleType: VEHICLE_TYPE[profile.vehicleClass] };
}

/** MAV_TYPE → planner vehicle class; undefined for a type the planner does not plan for. */
function vehicleClassOf(mavType: number): PlanVehicleClass | undefined {
  if (mavType === 1) return "plane";
  if (mavType === 10 || mavType === 11) return "rover"; // ground rover, surface boat
  if (mavType >= 19 && mavType <= 25) return "vtol"; // MAV_TYPE_VTOL_*
  // quadrotor, coaxial, helicopter, hexarotor, octorotor, tricopter, dodecarotor, decarotor
  if ([2, 3, 4, 13, 14, 15, 29, 35].includes(mavType)) return "copter";
  return undefined;
}

/** The plan profile a `.plan` names, or undefined when either code is one the planner does not know. */
export function profileFromQGC(firmwareType: unknown, vehicleType: unknown): PlanVehicleProfile | undefined {
  const autopilot = firmwareType === 3 ? "ardupilot" : firmwareType === 12 ? "px4" : undefined;
  const vehicleClass = typeof vehicleType === "number" ? vehicleClassOf(vehicleType) : undefined;
  return autopilot && vehicleClass ? { autopilot, vehicleClass } : undefined;
}

// ── Altitude mode ────────────────────────────────────────────

/** QGC AltitudeMode value meaning the plan mixes altitude modes. */
export const QGC_ALT_MODE_MIXED = 0;

/**
 * QGC AltitudeMode for a MAV_FRAME (1 relative, 2 absolute, 4 terrain frame);
 * undefined for a frame that carries no altitude (MAV_FRAME_MISSION).
 */
export function qgcAltitudeMode(frame: number): number | undefined {
  switch (frame) {
    case 3: case 6: return 1; // GLOBAL_RELATIVE_ALT (+ _INT)
    case 0: case 5: return 2; // GLOBAL (+ _INT)
    case 10: case 11: return 4; // GLOBAL_TERRAIN_ALT (+ _INT)
    default: return undefined;
  }
}

// ── Import: item expansion ───────────────────────────────────

/** State shared across the expansion of one plan's items. */
export interface PlanExpansion {
  /** File `doJumpId` → the seq of the first item it expanded to. */
  jumpSeq: Map<number, number>;
  warnings: string[];
}

/** Complex items QGC rebuilds from its own geometry and saves without mission items. */
const REBUILT_COMPLEX_ITEMS: Record<string, true> = { StructureScan: true, fwLandingPattern: true, vtolLandingPattern: true };

/**
 * A `.plan` parameter: JSON `null` is QGC's NaN ("use the vehicle's current
 * value"), so it stays NaN rather than becoming 0; an absent slot is 0.
 */
function planParam(value: number | null | undefined, absent: number): number {
  if (value === null) return Number.NaN;
  return typeof value === "number" ? value : absent;
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

/**
 * Convert one QGC SimpleItem into a wire `MissionItem`. `params[0..3]` are
 * MAVLink `param1..4` verbatim, NaN (`null`) included. A missing flown
 * altitude stays NaN so {@link assertAltitudes} refuses it. `seq` is assigned
 * by the caller from row order so a `DO_JUMP`'s `doJumpId`-space target resolves.
 */
function simpleItemToWireItem(item: QGCMissionItem, seq: number): MissionItem {
  const params = item.params ?? [];
  const command = typeof item.command === "number" ? item.command : cmdMap.WAYPOINT;
  // A null latitude/longitude is no position (0,0: "fly from here"); a null
  // param5/param6 of a non-location command is NaN like any other slot.
  const located = itemCarriesLocation(command);
  const xy = (v: number | null | undefined) => (located && v === null ? 0 : planParam(v, 0));
  const [x, y] = wireXY(command, xy(params[4]), xy(params[5]));
  return {
    seq,
    current: seq === 1 ? 1 : 0,
    frame: typeof item.frame === "number" ? item.frame : frameToMav(DEFAULT_ALTITUDE_FRAME),
    command,
    param1: planParam(params[0], 0),
    param2: planParam(params[1], 0),
    param3: planParam(params[2], 0),
    param4: planParam(params[3], 0),
    x,
    y,
    z: planParam(params[6], carriesAltitude(command) ? Number.NaN : 0),
    autocontinue: item.autoContinue === false ? 0 : 1,
  };
}

/**
 * Expand a single mission item into wire items. SimpleItems map 1:1; a
 * ComplexItem / TransectStyleComplexItem (survey / corridor grid) is expanded
 * from its embedded transect items or coordinates. A structure scan or landing
 * pattern, which QGC saves as geometry only, is skipped with a warning. Any
 * other complex item that carries no expandable geometry throws rather than
 * being silently dropped. Sequence numbers come from output position (from
 * 1), not the file; each item's file `doJumpId` is recorded against the seq it
 * starts at, so DO_JUMP targets can be rewritten into the output numbering.
 */
export function expandPlanItem(item: QGCMissionItem, out: MissionItem[], ctx: PlanExpansion): void {
  if (typeof item.doJumpId === "number" && Number.isFinite(item.doJumpId)) {
    ctx.jumpSeq.set(item.doJumpId, out.length + 1);
  }

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
      for (const sub of embedded) expandPlanItem(sub, out, ctx);
      return;
    }

    if (item.complexItemType !== undefined && REBUILT_COMPLEX_ITEMS[item.complexItemType] === true) {
      ctx.warnings.push(`Skipped ${item.complexItemType}: re-create it in the planner`);
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

  ctx.warnings.push(`Skipped a mission item of unsupported type "${item.type ?? "none"}"`);
}

/**
 * Rewrite each DO_JUMP's target from the file's `doJumpId` numbering into the
 * output seq. A file that numbers no items keeps its targets as written; a
 * jump whose target is not in the plan is dropped with a warning rather than
 * landing on whatever item now holds that number.
 */
export function resolvePlanJumps(items: MissionItem[], ctx: PlanExpansion): MissionItem[] {
  if (ctx.jumpSeq.size === 0) return items;
  const out: MissionItem[] = [];
  for (const item of items) {
    if (item.command !== cmdMap.DO_JUMP) {
      out.push(item);
      continue;
    }
    const seq = ctx.jumpSeq.get(item.param1);
    if (seq === undefined) {
      ctx.warnings.push(`Dropped DO_JUMP at item ${item.seq}: its target (item ${item.param1}) is not in the plan`);
      continue;
    }
    out.push({ ...item, param1: seq });
  }
  return out;
}
