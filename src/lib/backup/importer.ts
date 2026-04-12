/**
 * Full archive restore — imports a ZIP backup into IDB stores.
 *
 * Merge strategy: for array stores (flight-history), merges by `id` field
 * with newer `updatedAt` winning. For object stores (settings, operator),
 * the import replaces the existing value.
 *
 * Phase 24c.
 *
 * @module backup/importer
 * @license GPL-3.0-only
 */

import JSZip from "jszip";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { FlightRecord } from "../types";

/** Known store filenames → IDB keys. */
const STORE_MAP: Record<string, string> = {
  "flight-history.json": "altcmd:flight-history",
  "settings.json": "altcmd:settings",
  "operator-profile.json": "altcmd:operator-profile",
  "aircraft-registry.json": "altcmd:aircraft-registry",
  "battery-registry.json": "altcmd:battery-registry",
  "equipment-registry.json": "altcmd:equipment-registry",
  "recordings-index.json": "altcmd:recordings-index",
  "plan-library.json": "altcmd:plan-library",
  "checklist-store.json": "altcmd:checklist-store",
  "loadout-store.json": "altcmd:loadout-store",
};

/** Array-type stores that should be merged by `id` instead of replaced. */
const MERGE_BY_ID_STORES = new Set(["altcmd:flight-history"]);

export interface ImportResult {
  storesRestored: number;
  recordsMerged: number;
  recordingsRestored: number;
  errors: string[];
}

/**
 * Import a ZIP backup file into IDB. Merges flight-history by id
 * (newer updatedAt wins). Other stores are replaced.
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
    zip = await JSZip.loadAsync(file);
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

  // Process named stores
  for (const [filename, idbKey] of Object.entries(STORE_MAP)) {
    const entry = zip.file(`stores/${filename}`);
    if (!entry) continue;

    try {
      const text = await entry.async("text");
      const data = JSON.parse(text);

      if (MERGE_BY_ID_STORES.has(idbKey) && Array.isArray(data)) {
        // Merge by id — newer updatedAt wins
        const existing = ((await idbGet(idbKey)) as FlightRecord[] | undefined) ?? [];
        const existingMap = new Map(existing.map((r) => [r.id, r]));

        for (const incoming of data as FlightRecord[]) {
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
      } else {
        // Replace
        await idbSet(idbKey, data);
      }

      result.storesRestored++;
    } catch (err) {
      result.errors.push(`Failed to restore ${filename}: ${(err as Error).message}`);
    }
  }

  // Process recordings
  const recordingFiles = Object.keys(zip.files).filter((f) => f.startsWith("recordings/"));
  for (const path of recordingFiles) {
    const entry = zip.file(path);
    if (!entry) continue;
    try {
      const text = await entry.async("text");
      const data = JSON.parse(text);
      const id = path.replace("recordings/", "").replace(".json", "");
      await idbSet(`altcmd:recording:${id}`, data);
      result.recordingsRestored++;
    } catch (err) {
      result.errors.push(`Failed to restore recording ${path}: ${(err as Error).message}`);
    }
  }

  return result;
}
