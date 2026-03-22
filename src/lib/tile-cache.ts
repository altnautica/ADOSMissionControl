/**
 * @module tile-cache
 * @description IndexedDB-based tile caching for Leaflet maps.
 * Stores tile image blobs with LRU eviction at a configurable max size.
 * Uses readonly transactions for reads and batches lastAccess writes
 * to avoid IndexedDB contention when many tiles load simultaneously.
 * @license GPL-3.0-only
 */

const DB_NAME = "tile-cache";
const STORE_NAME = "tiles";
const DB_VERSION = 1;
const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB
const ACCESS_FLUSH_INTERVAL = 2000; // ms

interface TileEntry {
  url: string;
  blob: Blob;
  size: number;
  lastAccess: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
        store.createIndex("lastAccess", "lastAccess", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Batched lastAccess updates to avoid readwrite contention
const pendingAccessUpdates: string[] = [];
let accessFlushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAccessUpdate(url: string): void {
  pendingAccessUpdates.push(url);
  if (!accessFlushTimer) {
    accessFlushTimer = setTimeout(flushAccessUpdates, ACCESS_FLUSH_INTERVAL);
  }
}

async function flushAccessUpdates(): Promise<void> {
  accessFlushTimer = null;
  const urls = pendingAccessUpdates.splice(0);
  if (urls.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();
    for (const url of urls) {
      const req = store.get(url);
      req.onsuccess = () => {
        const entry = req.result as TileEntry | undefined;
        if (entry) {
          entry.lastAccess = now;
          store.put(entry);
        }
      };
    }
  } catch {
    // Silently fail — access tracking is best-effort
  }
}

export async function getCachedTile(url: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(url);
      getReq.onsuccess = () => {
        const entry = getReq.result as TileEntry | undefined;
        if (entry) {
          queueAccessUpdate(url);
          resolve(entry.blob);
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function cacheTile(url: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    const entry: TileEntry = {
      url,
      blob,
      size: blob.size,
      lastAccess: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Evict old tiles if cache exceeds max size (fire and forget)
    evictIfNeeded().catch(() => {});
  } catch {
    // Silently fail — caching is best-effort
  }
}

async function evictIfNeeded(): Promise<void> {
  const db = await openDB();

  // Calculate total size
  const entries = await new Promise<TileEntry[]>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as TileEntry[]);
    req.onerror = () => resolve([]);
  });

  let totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  if (totalSize <= MAX_CACHE_BYTES) return;

  // Sort by last access ascending (oldest first) for LRU eviction
  entries.sort((a, b) => a.lastAccess - b.lastAccess);

  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  for (const entry of entries) {
    if (totalSize <= MAX_CACHE_BYTES * 0.8) break; // Evict down to 80%
    store.delete(entry.url);
    totalSize -= entry.size;
  }
}
