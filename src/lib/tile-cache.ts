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

/**
 * Running total of cached bytes. Summed once per session with a cursor over
 * the store, then kept current by every write, delete and clear, so a tile
 * write never has to scan the whole cache to decide on eviction.
 */
let totalBytesPromise: Promise<number> | null = null;

function sumStoredBytes(db: IDBDatabase): Promise<number> {
  return new Promise((resolve) => {
    let sum = 0;
    const req = db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(sum);
        return;
      }
      sum += (cursor.value as TileEntry).size;
      cursor.continue();
    };
    req.onerror = () => resolve(sum);
  });
}

async function adjustTotalBytes(db: IDBDatabase, delta: number): Promise<number> {
  totalBytesPromise = (totalBytesPromise ?? sumStoredBytes(db)).then(
    (total) => Math.max(0, total + delta),
  );
  return totalBytesPromise;
}

export async function cacheTile(url: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    // Start the one-time baseline sum before this write's transaction is
    // created: IndexedDB orders overlapping transactions by creation, so the
    // sum never already includes the tile it is about to be adjusted for.
    void adjustTotalBytes(db, 0);
    const entry: TileEntry = {
      url,
      blob,
      size: blob.size,
      lastAccess: Date.now(),
    };

    // Read the replaced entry's size in the same transaction as the put, so
    // the running total counts a re-cached tile once.
    const replacedBytes = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      let replaced = 0;
      const getReq = store.get(url);
      getReq.onsuccess = () => {
        replaced = (getReq.result as TileEntry | undefined)?.size ?? 0;
        store.put(entry);
      };
      tx.oncomplete = () => resolve(replaced);
      tx.onerror = () => reject(tx.error);
    });

    const total = await adjustTotalBytes(db, entry.size - replacedBytes);
    if (total > MAX_CACHE_BYTES) scheduleEviction();
  } catch {
    // Silently fail — caching is best-effort
  }
}

/** Get cache statistics: tile count and total size in bytes. */
export async function getCacheStats(): Promise<{ tileCount: number; totalBytes: number }> {
  try {
    const db = await openDB();
    const tileCount = await new Promise<number>((resolve) => {
      const req = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    return { tileCount, totalBytes: await adjustTotalBytes(db, 0) };
  } catch {
    return { tileCount: 0, totalBytes: 0 };
  }
}

/** Delete all cached tiles. */
export async function clearAllTiles(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    totalBytesPromise = Promise.resolve(0);
  } catch {
    // Silently fail
  }
}

/** Maximum cache size constant (exported for UI display). */
export const MAX_CACHE_SIZE = MAX_CACHE_BYTES;

/** Eviction runs at most once per interval, never two at a time. */
const EVICTION_INTERVAL_MS = 10_000;
let evictionTimer: ReturnType<typeof setTimeout> | null = null;
let lastEvictionAt = 0;

function scheduleEviction(): void {
  if (evictionTimer) return;
  const wait = Math.max(0, lastEvictionAt + EVICTION_INTERVAL_MS - Date.now());
  evictionTimer = setTimeout(() => {
    evictIfNeeded()
      .catch(() => {})
      .finally(() => {
        lastEvictionAt = Date.now();
        evictionTimer = null;
      });
  }, wait);
}

/** Delete least-recently-used tiles, oldest first through the lastAccess
 * index, until the cache is back down to 80% of its limit. */
async function evictIfNeeded(): Promise<void> {
  const db = await openDB();
  const total = await adjustTotalBytes(db, 0);
  if (total <= MAX_CACHE_BYTES) return;

  const target = MAX_CACHE_BYTES * 0.8;
  const freed = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).index("lastAccess").openCursor();
    let removed = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || total - removed <= target) return;
      removed += (cursor.value as TileEntry).size;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
  });
  await adjustTotalBytes(db, -freed);
}
