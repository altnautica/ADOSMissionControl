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
import type { GeofenceSnapshot } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { PointOfInterest } from "@/stores/plan-poi-store";
import { parseKML } from "@/lib/formats/kml-parser";
import { parseKMZ } from "@/lib/formats/kmz-handler";
import { parseKmlBoundary } from "@/lib/formats/kml-boundary";
import { parseShapefile } from "@/lib/formats/shp-import";
import { exportKML, exportKMZ } from "@/lib/formats/kml-exporter";
import { downloadCSV, parseCSV } from "@/lib/formats/csv-handler";
import { foldLegacyWaypoints } from "@/lib/mission/mission-expand";
import {
  parseWaypointsFile,
  parseQGCPlan,
  exportWaypointsFormat,
  exportQGCPlan,
} from "./mission-io-formats";

// Re-export format functions so existing imports keep working
export {
  cmdMap,
  reverseCmd,
  exportWaypointsFormat,
  parseWaypointsFile,
  exportQGCPlan,
  parseQGCPlan,
} from "./mission-io-formats";

const AUTOSAVE_KEY = "altcmd_autosave";
const RECENT_KEY = "altcmd_recent_missions";
const MAX_RECENT = 10;

export interface MissionMetadata {
  name: string;
  droneId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MissionFile {
  /** v1 = legacy flat waypoint list. v2 = per-waypoint nested `actions[]`. */
  version: 1 | 2;
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
const MISSION_FILE_VERSION = 2 as const;

/**
 * Migrate a parsed native mission file forward to the current schema version.
 * v2 nests action commands (DO_/CONDITION_) under the navigation waypoint they
 * fire at; a v1 file carries a legacy flat waypoint list, so its action rows are
 * folded into `actions[]` here. Idempotent for an already-current file.
 */
export function migrateMissionFile(data: MissionFile): MissionFile {
  if ((data.version ?? 1) < 2) {
    return { ...data, version: MISSION_FILE_VERSION, waypoints: foldLegacyWaypoints(data.waypoints) };
  }
  return data;
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
  rally?: RallyPoint[];
}

interface RecentMission {
  name: string;
  date: number;
  wpCount: number;
  key: string;
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

    const recent = localStorage.getItem(RECENT_KEY);
    if (recent) {
      await set(RECENT_KEY, JSON.parse(recent));
      localStorage.removeItem(RECENT_KEY);
    }

    const keysToMigrate: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("altcmd_mission_")) {
        keysToMigrate.push(key);
      }
    }
    for (const key of keysToMigrate) {
      const val = localStorage.getItem(key);
      if (val) {
        await set(key, JSON.parse(val));
        localStorage.removeItem(key);
      }
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
export async function downloadMissionFile(
  waypoints: Waypoint[],
  metadata: MissionMetadata,
  extras?: MissionExtras,
): Promise<void> {
  const file: MissionFile = {
    version: MISSION_FILE_VERSION,
    metadata: { ...metadata, updatedAt: Date.now() },
    waypoints,
    ...(extras?.geofence ? { geofence: extras.geofence } : {}),
    ...(extras?.rally && extras.rally.length > 0 ? { rally: extras.rally } : {}),
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${metadata.name || "mission"}.altmission`;
  a.click();
  URL.revokeObjectURL(url);
  await addToRecent(metadata.name, waypoints.length);
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

/** Write the debounced snapshot. Storage failures are non-fatal by design. */
function writeAutoSave(data: MissionFile): Promise<void> {
  return set(AUTOSAVE_KEY, data).catch(() => {});
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

/** Get auto-saved mission data. */
export async function getAutoSave(): Promise<MissionFile | null> {
  try {
    const data = await get<MissionFile>(AUTOSAVE_KEY);
    if (!data || !data.waypoints?.length) return null;
    return migrateMissionFile(data);
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

// ── Named mission storage ───────────────────────────────────

/** Save to IndexedDB with a named key + add to recents. */
export async function saveMissionToStorage(waypoints: Waypoint[], metadata: MissionMetadata): Promise<void> {
  const key = `altcmd_mission_${Date.now()}`;
  const file: MissionFile = {
    version: MISSION_FILE_VERSION,
    metadata: { ...metadata, updatedAt: Date.now() },
    waypoints,
  };
  try {
    await set(key, file);
    await addToRecent(metadata.name, waypoints.length, key);
  } catch {
    // silent
  }
}

/** Get recent missions list. */
export async function getRecentMissions(): Promise<RecentMission[]> {
  try {
    const recent = await get<RecentMission[]>(RECENT_KEY);
    return recent ?? [];
  } catch {
    return [];
  }
}

/** Load a mission from IndexedDB by key. */
export async function loadMissionFromStorage(key: string): Promise<MissionFile | null> {
  try {
    const data = await get<MissionFile>(key);
    return data ? migrateMissionFile(data) : null;
  } catch {
    return null;
  }
}

// ── Format detection ─────────────────────────────────────────

/** Detect mission file format by extension and parse appropriately. */
export async function importMissionFile(file: File): Promise<ImportedMission> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "waypoints") {
    const text = await file.text();
    return { waypoints: parseWaypointsFile(text) };
  }

  if (ext === "plan") {
    const text = await file.text();
    const { waypoints, geofence, rally } = parseQGCPlan(text);
    return { waypoints, geofence, rally };
  }

  if (ext === "kml") {
    const text = await file.text();
    const result = parseKML(text);
    return { waypoints: result.waypoints };
  }

  if (ext === "kmz") {
    const result = await parseKMZ(file);
    return { waypoints: result.waypoints };
  }

  if (ext === "csv") {
    const text = await file.text();
    return { waypoints: parseCSV(text) };
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
  };
}

// ── Boundary import (KML / KMZ / shapefile) ─────────────────

/**
 * Import a boundary polygon from a KML/KMZ file or an ESRI shapefile (a zipped
 * `.zip` bundle or a bare `.shp`). Returns the polygon rings as `[lat, lon]`
 * pairs — distinct from mission waypoints — so the caller can drop them into the
 * drawing store as survey boundaries. Returns an empty array when the file
 * carries no polygon (never a fabricated shape); throws only on an unsupported
 * extension.
 *
 * @param file Uploaded KML/KMZ/ZIP/SHP file.
 * @returns Boundary rings, `[lat, lon][]` each; empty when none found.
 */
export async function importBoundaryFile(file: File): Promise<[number, number][][]> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "kml") {
    const text = await file.text();
    return parseKmlBoundary(text);
  }

  if (ext === "kmz") {
    const result = await parseKMZ(file);
    return result.polygons;
  }

  if (ext === "zip" || ext === "shp") {
    const buffer = await file.arrayBuffer();
    return parseShapefile(buffer);
  }

  throw new Error("Unsupported boundary file. Use KML, KMZ, ZIP, or SHP.");
}

// ── KML/KMZ/CSV Export Wrappers ─────────────────────────────

/** Export waypoints as a .kml file. */
export function exportMissionKML(waypoints: Waypoint[], name: string): void {
  exportKML(waypoints, name);
}

/** Export waypoints as a .kmz file. */
export async function exportMissionKMZ(waypoints: Waypoint[], name: string): Promise<void> {
  await exportKMZ(waypoints, name);
}

/** Export waypoints as a .csv file. */
export function exportMissionCSV(waypoints: Waypoint[], name: string): void {
  downloadCSV(waypoints, name);
}

// ── Recent missions ──────────────────────────────────────────

async function addToRecent(name: string, wpCount: number, key?: string): Promise<void> {
  try {
    const recent = await getRecentMissions();
    recent.unshift({ name, date: Date.now(), wpCount, key: key || "" });
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
    await set(RECENT_KEY, recent);
  } catch {
    // silent
  }
}
