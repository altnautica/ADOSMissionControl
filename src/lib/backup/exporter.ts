/**
 * Full archive backup — exports all IDB stores to a ZIP file.
 *
 * Phase 24c.
 *
 * @module backup/exporter
 * @license GPL-3.0-only
 */

import JSZip from "jszip";
import { get as idbGet, keys as idbKeys } from "idb-keyval";

/** Known IDB keys to export (non-recording stores). */
const STORE_KEYS = [
  "altcmd:flight-history",
  "altcmd:settings",
  "altcmd:operator-profile",
  "altcmd:aircraft-registry",
  "altcmd:battery-registry",
  "altcmd:equipment-registry",
  "altcmd:recordings-index",
  "altcmd:plan-library",
  "altcmd:checklist-store",
  "altcmd:loadout-store",
] as const;

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
  for (const key of STORE_KEYS) {
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ados-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
