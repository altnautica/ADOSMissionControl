/**
 * @module mission-io
 * @description Mission save/load/autosave utilities for the .altmission file format.
 *
 * File format: `.altmission` — JSON with `{ version, metadata, waypoints }`
 * plus optional `geofence`, `rally` and `pois` blocks so the native format
 * captures the whole plan (path + fence + rally + POIs), not just the path.
 * Autosave uses a 2-second debounce timer writing to IndexedDB under the key
 * `altcmd_autosave`, carrying the same blocks. Call {@link flushAutoSave} on
 * page unmount so the last debounce window is written rather than discarded.
 *
 * Data persisted via idb-keyval (IndexedDB). On first load, any existing
 * localStorage data is migrated to IndexedDB automatically.
 *
 * @license GPL-3.0-only
 */

import { get, set, del } from "idb-keyval";
import type { Waypoint } from "@/lib/types";
import type { GeofenceSnapshot, FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { PointOfInterest } from "@/stores/plan-poi-store";
import { parseKML } from "@/lib/formats/kml-parser";
import { parseKMZ } from "@/lib/formats/kmz-handler";
import { parseKmlBoundary, type BoundaryPolygon } from "@/lib/formats/kml-boundary";
import { parseShapefile } from "@/lib/formats/shp-import";
import { exportKML, exportKMZ } from "@/lib/formats/kml-exporter";
import { downloadCSV, parseCSV } from "@/lib/formats/csv-handler";
import { foldLegacyWaypoints } from "@/lib/mission/flat-rows";
import { migrateWaypointSlots } from "@/lib/mission/waypoint-slot-migration";
import {
  parseWaypointsFile,
  parseQGCPlan,
  exportWaypointsFormat,
  exportQGCPlan,
  type FlatExportOptions,
} from "./mission-io-formats";
import { usePlannerStore } from "@/stores/planner-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { downloadBlob } from "@/lib/download";

const AUTOSAVE_KEY = "altcmd_autosave";

export interface MissionMetadata {
  name: string;
  droneId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MissionFile {
  /**
   * v1 = legacy flat waypoint list. v2 = per-waypoint nested `actions[]`.
   * v3 = iNav action on `command`; LOITER_TURNS / PAYLOAD_PLACE values in the
   * slots that reach the right MAVLink parameter.
   */
  version: 1 | 2 | 3;
  metadata: MissionMetadata;
  waypoints: Waypoint[];
  /** Operator geofence, preserved so the native format round-trips the fence. */
  geofence?: GeofenceSnapshot;
  /** Rally (safe return) points, preserved on native round-trip. */
  rally?: RallyPoint[];
  /** Plan-attached points of interest, preserved on native round-trip. */
  pois?: PointOfInterest[];
}

/** Current native-file schema version written on every export. */
export const MISSION_FILE_VERSION = 3 as const;

/**
 * Migrate a parsed native mission file forward to the current schema version.
 * v2 nests action commands (DO_/CONDITION_) under the navigation waypoint they
 * fire at; a v1 file carries a legacy flat waypoint list, so its action rows are
 * folded into `actions[]` here. v3 rewrites the per-command parameter slots.
 * Idempotent for an already-current file.
 */
export function migrateMissionFile(data: MissionFile): MissionFile {
  const version = data.version ?? 1;
  if (version >= MISSION_FILE_VERSION) return data;
  const nested = version < 2 ? foldLegacyWaypoints(data.waypoints) : data.waypoints;
  return { ...data, version: MISSION_FILE_VERSION, waypoints: migrateWaypointSlots(nested) };
}

/**
 * Optional fence + rally + POI payload written alongside the waypoints. The
 * planner's autosave carries these too: a mission is not just its path, and an
 * autosave that drops the fence loses work the operator did draw.
 */
export interface MissionExtras {
  geofence?: GeofenceSnapshot;
  rally?: RallyPoint[];
  pois?: PointOfInterest[];
}

/**
 * Result of importing any supported mission file. Formats that carry a fence /
 * rally (native `.altmission`, QGC `.plan`) populate those fields; the rest
 * leave them undefined.
 */
export interface ImportedMission {
  waypoints: Waypoint[];
  metadata?: MissionMetadata;
  geofence?: GeofenceSnapshot;
  /**
   * Fence geometry from a format that carries no fence settings (`.plan`);
   * the importer merges it into the current fence with `withImportedFenceZones`.
   */
  fenceZones?: FenceZone[];
  rally?: RallyPoint[];
  /** Plan points of interest (native `.altmission` only). */
  pois?: PointOfInterest[];
  /** Items the parser could not keep (named), for the importer to show. */
  warnings?: string[];
}

// ── One-time localStorage → IndexedDB migration ────────────

async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // The IndexedDB read is inside the try: in environments without IndexedDB
    // (some test runners, private browsing) `get` throws, and this migration is
    // best-effort — it must never surface as an unhandled rejection.
    const migrated = await get("altcmd:migrated");
    if (migrated) return;

    const autosave = localStorage.getItem(AUTOSAVE_KEY);
    if (autosave) {
      await set(AUTOSAVE_KEY, JSON.parse(autosave));
      localStorage.removeItem(AUTOSAVE_KEY);
    }

    await set("altcmd:migrated", true);
  } catch {
    // Migration failed — not critical
  }
}

if (typeof window !== "undefined") {
  void migrateFromLocalStorage().catch(() => {});
}

// ── File download/upload ────────────────────────────────────

/** Save mission as downloadable .altmission JSON file. */
export function downloadMissionFile(
  waypoints: Waypoint[],
  metadata: MissionMetadata,
  extras?: MissionExtras,
): void {
  const file: MissionFile = {
    version: MISSION_FILE_VERSION,
    metadata: { ...metadata, updatedAt: Date.now() },
    waypoints,
    ...(extras?.geofence ? { geofence: extras.geofence } : {}),
    ...(extras?.rally && extras.rally.length > 0 ? { rally: extras.rally } : {}),
    ...(extras?.pois && extras.pois.length > 0 ? { pois: extras.pois } : {}),
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${metadata.name || "mission"}.altmission`);
}

/** Load mission from a File object. */
export async function loadMissionFile(file: File): Promise<MissionFile> {
  const text = await file.text();
  const data = JSON.parse(text) as MissionFile;
  if (!data.version || !data.waypoints || !Array.isArray(data.waypoints)) {
    throw new Error("Invalid .altmission file");
  }
  return migrateMissionFile(data);
}

// ── Autosave ────────────────────────────────────────────────

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** The payload the pending timer would write, so it can be flushed early. */
let pendingAutoSave: MissionFile | null = null;

type AutoSaveFailureListener = (err: unknown) => void;
const autoSaveFailureListeners = new Set<AutoSaveFailureListener>();
/** True after a failed write until the next one succeeds; only the first failure is reported. */
let autoSaveFailing = false;

/**
 * Be told when the planner autosave could not be written (storage full or
 * blocked). Reported once per run of failures, again only after a write has
 * succeeded in between. Returns the unsubscribe function.
 */
export function onAutoSaveFailure(listener: AutoSaveFailureListener): () => void {
  autoSaveFailureListeners.add(listener);
  return () => {
    autoSaveFailureListeners.delete(listener);
  };
}

/** Write the debounced snapshot. A failure is reported, never thrown. */
async function writeAutoSave(data: MissionFile): Promise<void> {
  try {
    await set(AUTOSAVE_KEY, data);
    autoSaveFailing = false;
  } catch (err) {
    if (autoSaveFailing) return;
    autoSaveFailing = true;
    for (const listener of autoSaveFailureListeners) listener(err);
  }
}

export function autoSave(
  waypoints: Waypoint[],
  metadata: Partial<MissionMetadata>,
  extras?: MissionExtras,
): void {
  clearTimeout(autoSaveTimer ?? undefined);
  pendingAutoSave = {
    version: MISSION_FILE_VERSION,
    metadata: {
      name: metadata.name || "Untitled",
      droneId: metadata.droneId,
      createdAt: metadata.createdAt || Date.now(),
      updatedAt: Date.now(),
    },
    waypoints,
    geofence: extras?.geofence,
    rally: extras?.rally,
    pois: extras?.pois,
  };
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    const data = pendingAutoSave;
    pendingAutoSave = null;
    if (data) void writeAutoSave(data);
  }, 2000);
}

/**
 * Write any pending autosave immediately. Call on unmount and on `beforeunload`
 * instead of {@link cancelAutoSave}: cancelling threw away up to the last two
 * seconds of edits every time the operator navigated away from the planner.
 */
export async function flushAutoSave(): Promise<void> {
  clearTimeout(autoSaveTimer ?? undefined);
  autoSaveTimer = null;
  const data = pendingAutoSave;
  pendingAutoSave = null;
  if (data) await writeAutoSave(data);
}

/**
 * Discard any pending auto-save without writing it. Only for paths that
 * deliberately drop the mission (a clear / new plan); a navigation away must
 * use {@link flushAutoSave}.
 */
export function cancelAutoSave(): void {
  clearTimeout(autoSaveTimer ?? undefined);
  autoSaveTimer = null;
  pendingAutoSave = null;
}

/**
 * Get auto-saved mission data: null when there is none or it holds nothing.
 * A fence, rally points or POIs drawn before any waypoint are work too, so an
 * autosave with any of them is returned.
 */
export async function getAutoSave(): Promise<MissionFile | null> {
  try {
    const data = await get<MissionFile>(AUTOSAVE_KEY);
    if (!data) return null;
    const fence = data.geofence;
    const hasContent =
      (data.waypoints?.length ?? 0) > 0 ||
      (fence !== undefined &&
        ((fence.zones?.length ?? 0) > 0 || (fence.polygonPoints?.length ?? 0) > 0 || fence.circleCenter !== null)) ||
      (data.rally?.length ?? 0) > 0 ||
      (data.pois?.length ?? 0) > 0;
    if (!hasContent) return null;
    return migrateMissionFile({ ...data, waypoints: data.waypoints ?? [] });
  } catch {
    return null;
  }
}

/** Clear auto-save. */
export async function clearAutoSave(): Promise<void> {
  try {
    await del(AUTOSAVE_KEY);
  } catch {
    // silent
  }
}

// ── Format detection ─────────────────────────────────────────

/** Detect mission file format by extension and parse appropriately. */
export async function importMissionFile(file: File): Promise<ImportedMission> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "waypoints") {
    const text = await file.text();
    return parseWaypointsFile(text);
  }

  if (ext === "plan") {
    const text = await file.text();
    return parseQGCPlan(text);
  }

  if (ext === "kml") {
    const text = await file.text();
    const result = parseKML(text, { defaultAlt: usePlannerStore.getState().defaultAlt });
    return { waypoints: result.waypoints, warnings: result.warnings };
  }

  if (ext === "kmz") {
    const result = await parseKMZ(file, { defaultAlt: usePlannerStore.getState().defaultAlt });
    return { waypoints: result.waypoints, warnings: result.warnings };
  }

  if (ext === "csv") {
    const text = await file.text();
    const warnings: string[] = [];
    const waypoints = parseCSV(text, warnings);
    return { waypoints, warnings };
  }

  // Default: try .altmission / .json
  const text = await file.text();
  const data = JSON.parse(text) as MissionFile;
  if (!data.version || !data.waypoints || !Array.isArray(data.waypoints)) {
    throw new Error("Invalid mission file format");
  }
  const migrated = migrateMissionFile(data);
  return {
    waypoints: migrated.waypoints,
    metadata: migrated.metadata,
    geofence: migrated.geofence,
    rally: migrated.rally,
    pois: migrated.pois,
  };
}

// ── Boundary import (KML / KMZ / shapefile) ─────────────────

/**
 * Import boundary polygons from a KML/KMZ file or an ESRI shapefile (a zipped
 * `.zip` bundle or a bare `.shp`). Returns each polygon's outer ring and its
 * interior rings (holes) as `[lat, lon]` pairs — distinct from mission
 * waypoints — so the caller can drop them into the drawing store as survey
 * boundaries and keep-out areas. Returns an empty array when the file carries
 * no polygon (never a fabricated shape). Throws on an unsupported extension,
 * and `ShapefileNotGeographicError` when a shapefile's coordinates are
 * projected rather than latitude/longitude.
 *
 * @param file Uploaded KML/KMZ/ZIP/SHP file.
 * @returns Boundaries with their holes; empty when none found.
 */
export async function importBoundaryFile(file: File): Promise<BoundaryPolygon[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "kml") {
    const text = await file.text();
    return parseKmlBoundary(text);
  }

  if (ext === "kmz") {
    const result = await parseKMZ(file);
    return result.polygons.map((outer, i) => ({ outer, holes: result.polygonHoles[i] ?? [] }));
  }

  if (ext === "zip" || ext === "shp") {
    const buffer = await file.arrayBuffer();
    return parseShapefile(buffer);
  }

  throw new Error("Unsupported boundary file. Use KML, KMZ, ZIP, or SHP.");
}

// ── Export options ───────────────────────────────────────────

/**
 * The altitude frame and home datum every mission export must carry.
 *
 * File export used to be called with no options at all, so
 * `exportWaypointsFormat` / `exportQGCPlan` fell back to
 * `DEFAULT_ALTITUDE_FRAME = "relative"` while `mission-store.uploadMission`
 * used `usePlannerStore.defaultFrame`. With the operator's default set to
 * `terrain`, the GCS uploaded `MAV_FRAME_GLOBAL_TERRAIN_ALT` (10) while the
 * exported `.plan` / `.waypoints` claimed `MAV_FRAME_GLOBAL_RELATIVE_ALT` (3).
 * Loading that file into another GCS — or re-importing it here, where
 * `collapseFromItems` stamps `relative` explicitly — flies terrain-following
 * altitudes as above-home. Over rising terrain that is controlled flight into
 * terrain.
 *
 * `home` is included only when a vehicle has actually reported one. Absent, the
 * flat-file writers fall back to the first waypoint as a PLANNED home at 0 m,
 * which is the format's documented placeholder rather than a surveyed datum.
 */
export function currentExportOptions(): FlatExportOptions {
  const home = useTelemetryStore.getState().homePosition.latest();
  const { defaultFrame, defaultSpeed } = usePlannerStore.getState();
  return {
    defaultFrame,
    defaultSpeed,
    home: home ? { lat: home.lat, lon: home.lon, alt: home.alt } : undefined,
  };
}

// ── KML/KMZ/CSV Export Wrappers ─────────────────────────────

/** Export waypoints as a .kml file, carrying the operator's altitude frame. */
export function exportMissionKML(waypoints: Waypoint[], name: string): void {
  exportKML(waypoints, name, { defaultFrame: currentExportOptions().defaultFrame });
}

/** Export waypoints as a .kmz file, carrying the operator's altitude frame. */
export async function exportMissionKMZ(waypoints: Waypoint[], name: string): Promise<void> {
  await exportKMZ(waypoints, name, { defaultFrame: currentExportOptions().defaultFrame });
}

/** Export waypoints as a .csv file. */
export function exportMissionCSV(waypoints: Waypoint[], name: string): void {
  downloadCSV(waypoints, name);
}
