/**
 * @module param-cache-idb
 * @description IndexedDB-backed parameter cache for offline access.
 * Persists panel params so they can be viewed when disconnected.
 * @license GPL-3.0-only
 */

import { get, set } from "idb-keyval";

const IDB_PREFIX = "param-cache:";

export interface CachedPanelData {
  droneId: string;
  panelId: string;
  params: Record<string, number>;
  timestamp: number;
}

/** One entry per drone and panel: a panel's cached values belong to the
 * vehicle they were read from and are never offered for another. */
function key(droneId: string, panelId: string): string {
  return `${IDB_PREFIX}${droneId}:${panelId}`;
}

/** Save one drone's panel params to IndexedDB. */
export async function cachePanelToIDB(
  droneId: string,
  panelId: string,
  params: Map<string, number>,
): Promise<void> {
  const data: CachedPanelData = {
    droneId,
    panelId,
    params: Object.fromEntries(params),
    timestamp: Date.now(),
  };
  await set(key(droneId, panelId), data);
}

/** Load one drone's cached panel params from IndexedDB, or null. */
export async function getCachedPanelFromIDB(
  droneId: string,
  panelId: string,
): Promise<CachedPanelData | null> {
  const data = await get<CachedPanelData>(key(droneId, panelId));
  return data ?? null;
}
