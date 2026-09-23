/**
 * Full archive backup — exports the operator's IndexedDB stores to a ZIP file.
 *
 * @module backup/exporter
 * @license GPL-3.0-only
 */

import JSZip from "jszip";
import { get as idbGet, keys as idbKeys } from "idb-keyval";
import { downloadBlob } from "@/lib/download";

/**
 * Every IndexedDB key a backup carries, and the only keys a restore writes:
 * flight history and its registries, plus the persisted working state (the
 * mission, fence, rally points, planner settings and drone names). Caches and
 * device identity are deliberately absent. The recordings index is exported
 * only alongside the recordings it lists.
 */
export const BACKUP_STORE_KEYS = [
  "altcmd:flight-history",
  "altcmd:flight-history-tombstones",
  "altcmd:settings",
  "altcmd:operator-profile",
  "altcmd:aircraft-registry",
  "altcmd:battery-registry",
  "altcmd:equipment-registry",
  "altcmd:recordings-index",
  "altcmd:plan-library",
  "altcmd:loadouts",
  "altcmd:mission-store",
  "altcmd:geofence-store",
  "altcmd:rally-store",
  "altcmd:planner-store",
  "altcmd:drone-metadata",
] as const;

const RECORDINGS_INDEX_KEY = "altcmd:recordings-index";

/**
 * Export all IDB stores to a ZIP file and trigger a download.
 * Optionally includes telemetry recordings (large — off by default).
 */
export async function exportBackup(includeRecordings = false): Promise<void> {
  const zip = new JSZip();

  // Metadata
  zip.file(
    "manifest.json",
    JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "ADOS Mission Control",
      includesRecordings: includeRecordings,
    }, null, 2),
  );

  // Named stores
  for (const key of BACKUP_STORE_KEYS) {
    if (key === RECORDINGS_INDEX_KEY && !includeRecordings) continue;
    try {
      const data = await idbGet(key);
      if (data !== undefined) {
        const filename = key.replace("altcmd:", "") + ".json";
        zip.file(`stores/${filename}`, JSON.stringify(data, null, 2));
      }
    } catch {
      // Skip inaccessible stores
    }
  }

  // Optionally include telemetry recordings (can be very large)
  if (includeRecordings) {
    const allKeys = await idbKeys();
    const recordingKeys = allKeys.filter(
      (k) => typeof k === "string" && k.startsWith("altcmd:recording:"),
    );
    for (const key of recordingKeys) {
      try {
        const data = await idbGet(key);
        if (data !== undefined) {
          const id = (key as string).replace("altcmd:recording:", "");
          zip.file(`recordings/${id}.json`, JSON.stringify(data));
        }
      } catch {
        // Skip
      }
    }
  }

  // Generate and download
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, `ados-backup-${new Date().toISOString().slice(0, 10)}.zip`);
}
