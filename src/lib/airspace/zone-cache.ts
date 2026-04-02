/**
 * @module airspace/zone-cache
 * @description IndexedDB cache for airspace zones. Stores generated zones per
 * jurisdiction so subsequent page loads are instant (no airport DB parse,
 * no circle polygon generation, no network requests).
 * Cache TTL: 24 hours. Falls back gracefully if IndexedDB is unavailable.
 * @license GPL-3.0-only
 */

import type { AirspaceZone } from "./types";

const DB_NAME = "ados-airspace-cache";
const STORE_NAME = "zones";
const DB_VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedEntry {
  key: string;
  zones: AirspaceZone[];
  timestamp: number;
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Get cached zones for a jurisdiction key. Returns null if expired or missing. */
export async function getCachedZones(key: string): Promise<AirspaceZone[] | null> {
  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = request.result as CachedEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > TTL_MS) {
          resolve(null); // expired
          return;
        }
        resolve(entry.zones);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store zones in the cache. */
export async function setCachedZones(key: string, zones: AirspaceZone[]): Promise<void> {
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const entry: CachedEntry = { key, zones, timestamp: Date.now() };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Clear all cached zone data. */
export async function clearZoneCache(): Promise<void> {
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
