/**
 * Full archive restore — imports a ZIP backup into IDB stores.
 *
 * Merge strategy:
 * - flight history merges by `id`, newer `updatedAt` winning, and never
 *   brings back a flight permanently deleted here (its id is tombstoned);
 * - tombstones are the union of the local and the backup's sets, so pending
 *   cloud deletes survive the restore;
 * - the recordings index merges by `id`, keeping local entries, and only
 *   lists recordings whose telemetry the backup actually carried;
 * - every other store (settings, operator, registries, working state) is
 *   replaced by the backup's value.
 *
 * @module backup/importer
 * @license GPL-3.0-only
 */

import type JSZip from "jszip";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { FlightRecord } from "../types";
import type { TelemetryRecording } from "../telemetry-recorder";
import { BACKUP_STORE_KEYS } from "./exporter";

/** Archive filenames → IDB keys, the same set the exporter writes. */
const STORE_MAP: Record<string, string> = Object.fromEntries(
  BACKUP_STORE_KEYS.map((key) => [`${key.replace("altcmd:", "")}.json`, key]),
);

const HISTORY_KEY = "altcmd:flight-history";
const TOMBSTONES_KEY = "altcmd:flight-history-tombstones";
const RECORDINGS_INDEX_KEY = "altcmd:recordings-index";
const RECORDING_PREFIX = "altcmd:recording:";

interface StoredTombstones {
  ids: string[];
  pending: string[];
}

export interface ImportResult {
  storesRestored: number;
  recordsMerged: number;
  recordingsRestored: number;
  errors: string[];
}

function readTombstones(value: unknown): StoredTombstones {
  const t = (value ?? {}) as Partial<StoredTombstones>;
  return {
    ids: Array.isArray(t.ids) ? t.ids : [],
    pending: Array.isArray(t.pending) ? t.pending : [],
  };
}

/** Local entries first, then the backup's entries not already present. */
function union(local: string[], incoming: string[]): string[] {
  const seen = new Set(local);
  const out = [...local];
  for (const id of incoming) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Import a ZIP backup file into IDB. See the module comment for how each
 * store is merged.
 */
export async function importBackup(file: File): Promise<ImportResult> {
  const result: ImportResult = {
    storesRestored: 0,
    recordsMerged: 0,
    recordingsRestored: 0,
    errors: [],
  };

  let zip: JSZip;
  try {
    // jszip is loaded on first use so it stays out of every route's first-load bundle.
    const { default: JSZipLib } = await import("jszip");
    zip = await JSZipLib.loadAsync(file);
  } catch {
    result.errors.push("Failed to read ZIP file.");
    return result;
  }

  // Validate manifest
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    result.errors.push("Missing manifest.json — not a valid ADOS backup.");
    return result;
  }

  // Flights deleted here before the restore stay deleted.
  const localTombstones = readTombstones(await idbGet(TOMBSTONES_KEY));
  const tombstoned = new Set(localTombstones.ids);

  // Recordings first, so the index lists only recordings that were restored.
  // A recording is stored as chunks: `<id>` is chunk 0, `<id>:<n>` chunk n.
  const restoredKeys = new Set<string>();
  const recordingFiles = Object.keys(zip.files).filter((f) => f.startsWith("recordings/") && f.endsWith(".json"));
  for (const path of recordingFiles) {
    const entry = zip.file(path);
    if (!entry) continue;
    try {
      const data: unknown = JSON.parse(await entry.async("text"));
      const key = path.slice("recordings/".length, -".json".length);
      await idbSet(`${RECORDING_PREFIX}${key}`, data);
      restoredKeys.add(key);
    } catch (err) {
      result.errors.push(`Failed to restore recording ${path}: ${(err as Error).message}`);
    }
  }
  const fullyRestored = (r: TelemetryRecording) => {
    if (!restoredKeys.has(r.id)) return false;
    for (let i = 1; i < (r.chunkCount ?? 1); i++) if (!restoredKeys.has(`${r.id}:${i}`)) return false;
    return true;
  };

  // Recordings a restored flight can point at: the ones already here plus the
  // backup's fully restored ones. A flight whose telemetry is in neither stops
  // claiming it, instead of offering a replay that cannot load.
  const localIndex = ((await idbGet(RECORDINGS_INDEX_KEY)) as TelemetryRecording[] | undefined) ?? [];
  const availableRecordings = new Set(localIndex.map((r) => r.id));
  const backupIndexEntry = zip.file(`stores/${RECORDINGS_INDEX_KEY.replace("altcmd:", "")}.json`);
  if (backupIndexEntry) {
    try {
      const backupIndex: unknown = JSON.parse(await backupIndexEntry.async("text"));
      if (Array.isArray(backupIndex)) {
        for (const r of backupIndex as TelemetryRecording[]) if (fullyRestored(r)) availableRecordings.add(r.id);
      }
    } catch {
      // Reported when the store itself is restored below.
    }
  }

  // Process named stores
  for (const [filename, idbKey] of Object.entries(STORE_MAP)) {
    const entry = zip.file(`stores/${filename}`);
    if (!entry) continue;

    try {
      const text = await entry.async("text");
      const data: unknown = JSON.parse(text);

      if (idbKey === HISTORY_KEY && Array.isArray(data)) {
        // Merge by id — newer updatedAt wins; tombstoned ids are skipped.
        const existing = ((await idbGet(idbKey)) as FlightRecord[] | undefined) ?? [];
        const existingMap = new Map(existing.map((r) => [r.id, r]));

        for (const record of data as FlightRecord[]) {
          if (tombstoned.has(record.id)) continue;
          const incoming =
            record.recordingId && !availableRecordings.has(record.recordingId)
              ? { ...record, recordingId: undefined, hasTelemetry: false }
              : record;
          const current = existingMap.get(incoming.id);
          if (!current || (incoming.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
            existingMap.set(incoming.id, incoming);
            result.recordsMerged++;
          }
        }

        const merged = Array.from(existingMap.values()).sort(
          (a, b) => (b.startTime ?? b.date) - (a.startTime ?? a.date),
        );
        await idbSet(idbKey, merged);
      } else if (idbKey === TOMBSTONES_KEY) {
        const incoming = readTombstones(data);
        const merged: StoredTombstones = {
          ids: union(localTombstones.ids, incoming.ids),
          pending: union(localTombstones.pending, incoming.pending),
        };
        await idbSet(idbKey, merged);
      } else if (idbKey === RECORDINGS_INDEX_KEY && Array.isArray(data)) {
        const existing = ((await idbGet(idbKey)) as TelemetryRecording[] | undefined) ?? [];
        const ids = new Set(existing.map((r) => r.id));
        const merged = [...existing];
        for (const incoming of data as TelemetryRecording[]) {
          if (!fullyRestored(incoming)) {
            result.errors.push(`Recording ${incoming.id} is listed in the backup but its telemetry is missing.`);
            continue;
          }
          result.recordingsRestored++;
          if (ids.has(incoming.id)) continue;
          ids.add(incoming.id);
          merged.push(incoming);
        }
        await idbSet(idbKey, merged);
      } else {
        // Replace
        await idbSet(idbKey, data);
      }

      result.storesRestored++;
    } catch (err) {
      result.errors.push(`Failed to restore ${filename}: ${(err as Error).message}`);
    }
  }

  return result;
}
