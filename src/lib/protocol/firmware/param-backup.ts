/**
 * Parameter backup taken before a firmware flash.
 *
 * The backup is persisted before the flight controller is rebooted into its
 * bootloader, in two places: IndexedDB under `fw-param-backup:<board>:<ISO
 * time>`, and a `.param` file the browser downloads. Restoring is never
 * automatic: after the flash the operator reviews a diff and chooses.
 *
 * @module protocol/firmware/param-backup
 */

import { set } from "idb-keyval";
import type { ParameterValue } from "../types";
import { serializeParamFile } from "@/lib/formats/param-file-parser";
import { downloadBlob } from "@/lib/download";

export const PARAM_BACKUP_KEY_PREFIX = "fw-param-backup:";

/** One saved parameter set. */
export interface FlashParamBackup {
  /** IndexedDB key: `fw-param-backup:<board>:<ISO time>`. */
  key: string;
  /** Board the backup was taken from (board id, or the selected board name). */
  board: string;
  /** ISO-8601 time the backup was taken. */
  createdAt: string;
  params: Array<{ name: string; value: number; type: number }>;
}

/**
 * Persist `params` to IndexedDB and download them as a `.param` file. Throws
 * when there is nothing to save or the browser store refuses the write, so a
 * flash never proceeds on a backup that does not exist.
 */
export async function saveFlashParamBackup(
  board: string,
  params: readonly ParameterValue[],
  now: Date = new Date(),
): Promise<FlashParamBackup> {
  if (params.length === 0) {
    throw new Error("The flight controller returned no parameters to back up");
  }
  const createdAt = now.toISOString();
  const backup: FlashParamBackup = {
    key: `${PARAM_BACKUP_KEY_PREFIX}${board}:${createdAt}`,
    board,
    createdAt,
    params: params.map((p) => ({ name: p.name, value: p.value, type: p.type })),
  };
  await set(backup.key, backup);
  const text = serializeParamFile(backup.params, { format: "mp" });
  downloadBlob(
    new Blob([text], { type: "text/plain" }),
    `params-before-flash-${board}-${createdAt.replace(/[:.]/g, "-")}.param`,
  );
  return backup;
}

