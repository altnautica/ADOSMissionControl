/**
 * History store — central source of truth for all flight records.
 *
 * Holds mock seed data + live-recorded flights + real log entries.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type { FlightRecord } from "@/lib/types";
import { createIdbStoreLoader } from "@/lib/idb-store-loader";

const IDB_HISTORY_KEY = "altcmd:flight-history";
const IDB_TOMBSTONES_KEY = "altcmd:flight-history-tombstones";
const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";
/** Tombstones kept so a cloud page cannot resurrect a permanently deleted flight. */
const MAX_TOMBSTONES = 2000;

interface StoredTombstones {
  /** Every permanently deleted clientId, oldest first. */
  ids: string[];
  /** The subset whose cloud row has not been confirmed removed yet. */
  pending: string[];
}

/** On-board log entry received via LOG_ENTRY (msg 118). */
export interface LogEntry {
  id: number;
  numLogs: number;
  lastLogId: number;
  size: number;
  /** Seconds since 1970 UTC, or 0 if unavailable. */
  timeUtc: number;
}

/** Active log download progress. */
export interface LogDownloadState {
  logId: number;
  totalSize: number;
  receivedBytes: number;
  data: Uint8Array;
}

export type CloudSyncStatus = "idle" | "syncing" | "error";

interface HistoryState {
  records: FlightRecord[];
  logEntries: Map<string, LogEntry[]>;
  logDownload: LogDownloadState | null;
  isLoadingLogList: boolean;
  isDownloadingLog: boolean;
  _seeded: boolean;

  // Cloud sync bookkeeping. The Convex client is injected from the React
  // layer (CloudSyncBridge); the store stays Zustand-only.
  syncStatus: CloudSyncStatus;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  /** clientIds dirty since the last successful upsert. */
  pendingSyncIds: Set<string>;
  /**
   * clientIds the cloud refused, with the refusal. The periodic retry skips
   * them until the record changes or the operator retries by hand.
   */
  syncErrors: Map<string, string>;
  /** clientIds permanently deleted here; cloud rows with these ids are never merged back. */
  tombstoneIds: Set<string>;
  /** Tombstoned clientIds whose cloud row still has to be removed. */
  pendingDeleteIds: Set<string>;
}

interface HistoryActions {
  /** One-time init from mock/history.ts seed data. */
  initWithSeedData: (records: FlightRecord[]) => void;
  /**
   * Add a new flight record (cap at 500) and mark it dirty for cloud sync.
   * A record whose id is already stored is left alone; returns false then.
   */
  addRecord: (record: FlightRecord) => boolean;
  /** Patch an existing record by id. Sets `updatedAt` and marks dirty. Noop if not found. */
  updateRecord: (id: string, patch: Partial<FlightRecord>) => void;
  /** Soft-delete a record (move to trash). */
  removeRecord: (id: string) => void;
  /** Restore a soft-deleted record from trash. */
  restoreRecord: (id: string) => void;
  /** Permanently delete a record (bypasses trash), tombstone it and drop its media blobs. */
  permanentlyDelete: (id: string) => void;
  /** Permanently delete all trashed records, like {@link permanentlyDelete}. */
  emptyTrash: () => void;
  /**
   * Async: read persisted records once and merge them into memory (stored
   * records win on id conflict). Idempotent; concurrent callers share one read.
   */
  ensureLoaded: () => Promise<void>;
  /** Async: write current records to IndexedDB, after the load completes. */
  persistToIDB: () => Promise<void>;
  /**
   * Merge a list of cloud records into the local store. Last-write-wins on
   * `updatedAt`. Records that exist locally but not in cloud stay put, and
   * tombstoned ids are never merged back.
   * Returns the count of records that were updated by the merge.
   */
  mergeCloudRecords: (cloudRecords: FlightRecord[]) => number;
  /** Set the global sync status. */
  setSyncStatus: (status: CloudSyncStatus, error?: string | null) => void;
  /** Record a successful sync timestamp and clear the dirty set. */
  markSynced: (ids: string[]) => void;
  /** Quarantine a record the cloud refused, keeping the refusal for display. */
  markSyncFailed: (id: string, error: string) => void;
  /** Record that the cloud rows of these tombstoned ids are gone. */
  markCloudDeleted: (ids: string[]) => void;
  /** Explicitly mark a clientId as dirty (and out of quarantine) so the next sync picks it up. */
  markDirty: (id: string) => void;
  /**
   * Async: drop demo flight records (id prefix "demo-") and demo telemetry
   * recordings from memory + IndexedDB, keeping every other record. Used by
   * the History page in demo mode before re-seeding.
   */
  resetDemoData: () => Promise<void>;
  /** Store log entries for a drone from LOG_ENTRY messages. */
  setLogEntries: (droneId: string, entries: LogEntry[]) => void;
  setIsLoadingLogList: (v: boolean) => void;
  startLogDownload: (logId: number, totalSize: number) => void;
  updateLogDownload: (receivedBytes: number, data: Uint8Array) => void;
  completeLogDownload: () => void;
  cancelLogDownload: () => void;
}

const MAX_RECORDS = 500;

/** Copy of `set` with `id` removed; the same instance when absent. */
function without<T>(set: Set<T>, id: T): Set<T> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

/** Copy of `errors` with `id` removed; the same instance when absent. */
function withoutError(errors: Map<string, string>, id: string): Map<string, string> {
  if (!errors.has(id)) return errors;
  const next = new Map(errors);
  next.delete(id);
  return next;
}

/** Mark `id` dirty and lift any quarantine, since the record changed. */
function dirtied(s: HistoryState, id: string): Pick<HistoryState, "pendingSyncIds" | "syncErrors"> {
  const pendingSyncIds = new Set(s.pendingSyncIds);
  pendingSyncIds.add(id);
  return { pendingSyncIds, syncErrors: withoutError(s.syncErrors, id) };
}

/** Drop the stored media blobs of records that are gone for good. */
function deleteMediaBlobs(records: FlightRecord[]): void {
  const keys = records.flatMap((r) => (r.media ?? []).map((m) => m.blobKey));
  for (const key of keys) {
    idbDel(key).catch((err: unknown) => {
      console.warn("[history-store] media blob delete failed", key, err);
    });
  }
}

/** Remove `doomed` from the store: tombstone each id and queue its cloud delete. */
function purge(s: HistoryState, doomed: FlightRecord[]): Partial<HistoryState> {
  if (doomed.length === 0) return {};
  const ids = new Set(doomed.map((r) => r.id));
  const pendingSyncIds = new Set(s.pendingSyncIds);
  const syncErrors = new Map(s.syncErrors);
  const tombstoneIds = new Set(s.tombstoneIds);
  const pendingDeleteIds = new Set(s.pendingDeleteIds);
  for (const id of ids) {
    pendingSyncIds.delete(id);
    syncErrors.delete(id);
    tombstoneIds.add(id);
    pendingDeleteIds.add(id);
  }
  return {
    records: s.records.filter((r) => !ids.has(r.id)),
    pendingSyncIds,
    syncErrors,
    tombstoneIds,
    pendingDeleteIds,
  };
}

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  records: [],
  logEntries: new Map(),
  logDownload: null,
  isLoadingLogList: false,
  isDownloadingLog: false,
  _seeded: false,
  syncStatus: "idle",
  lastSyncAt: null,
  lastSyncError: null,
  pendingSyncIds: new Set<string>(),
  syncErrors: new Map<string, string>(),
  tombstoneIds: new Set<string>(),
  pendingDeleteIds: new Set<string>(),

  initWithSeedData: (records) => {
    if (get()._seeded) return;
    // Merge: keep any IDB-loaded records and append seed records that don't
    // collide by id. This lets demo seed and real persisted history coexist.
    const existing = new Map(get().records.map((r) => [r.id, r] as const));
    for (const r of records) if (!existing.has(r.id)) existing.set(r.id, r);
    const merged = Array.from(existing.values()).sort(
      (a, b) => (b.startTime ?? b.date) - (a.startTime ?? a.date),
    );
    set({ records: merged.slice(0, MAX_RECORDS), _seeded: true });
  },

  addRecord: (record) => {
    if (get().records.some((r) => r.id === record.id)) return false;
    set((s) => ({
      records: [{ ...record, cloudSynced: false }, ...s.records].slice(0, MAX_RECORDS),
      ...dirtied(s, record.id),
      // Re-adding a deleted flight (a re-import) supersedes its tombstone.
      tombstoneIds: without(s.tombstoneIds, record.id),
      pendingDeleteIds: without(s.pendingDeleteIds, record.id),
    }));
    return true;
  },

  updateRecord: (id, patch) => {
    set((s) => {
      let changed = false;
      const records = s.records.map((r) => {
        if (r.id !== id) return r;
        changed = true;
        return { ...r, ...patch, updatedAt: Date.now(), cloudSynced: false };
      });
      if (!changed) return s;
      return { records, ...dirtied(s, id) };
    });
  },

  removeRecord: (id) => {
    // Soft-delete: mark as deleted instead of removing.
    set((s) => {
      let changed = false;
      const records = s.records.map((r) => {
        if (r.id !== id || r.deleted) return r;
        changed = true;
        return { ...r, deleted: true, deletedAt: Date.now(), updatedAt: Date.now(), cloudSynced: false };
      });
      if (!changed) return s;
      return { records, ...dirtied(s, id) };
    });
  },

  restoreRecord: (id) => {
    set((s) => {
      let changed = false;
      const records = s.records.map((r) => {
        if (r.id !== id || !r.deleted) return r;
        changed = true;
        return { ...r, deleted: undefined, deletedAt: undefined, updatedAt: Date.now(), cloudSynced: false };
      });
      if (!changed) return s;
      return { records, ...dirtied(s, id) };
    });
  },

  permanentlyDelete: (id) => {
    const doomed = get().records.filter((r) => r.id === id);
    set((s) => purge(s, doomed));
    deleteMediaBlobs(doomed);
  },

  emptyTrash: () => {
    const doomed = get().records.filter((r) => r.deleted);
    set((s) => purge(s, doomed));
    deleteMediaBlobs(doomed);
  },

  ensureLoaded: () => idb.ensureLoaded(),

  // Demo seed records (id prefix "demo-") are reseeded on every demo mode
  // load and must never pollute IDB. Real imports, dataflash logs, and
  // live-hardware flights use other id schemes and persist normally.
  persistToIDB: () =>
    idb.persist(async () => {
      await idbSet(IDB_HISTORY_KEY, get().records.filter((r) => !r.id.startsWith("demo-")));
      const { tombstoneIds, pendingDeleteIds } = get();
      const stored: StoredTombstones = {
        ids: Array.from(tombstoneIds).slice(-MAX_TOMBSTONES),
        pending: Array.from(pendingDeleteIds),
      };
      await idbSet(IDB_TOMBSTONES_KEY, stored);
    }),

  mergeCloudRecords: (cloudRecords) => {
    let updatedCount = 0;
    set((s) => {
      const localById = new Map(s.records.map((r) => [r.id, r] as const));
      for (const remote of cloudRecords) {
        if (s.tombstoneIds.has(remote.id)) continue;
        const local = localById.get(remote.id);
        if (!local) {
          localById.set(remote.id, { ...remote, cloudSynced: true });
          updatedCount += 1;
          continue;
        }
        // Last-write-wins: only overwrite if the remote is strictly newer.
        if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
          localById.set(remote.id, { ...remote, cloudSynced: true });
          updatedCount += 1;
        }
      }
      const merged = Array.from(localById.values()).sort(
        (a, b) => (b.startTime ?? b.date) - (a.startTime ?? a.date),
      );
      return { records: merged.slice(0, MAX_RECORDS) };
    });
    return updatedCount;
  },

  setSyncStatus: (status, error = null) => {
    set({ syncStatus: status, lastSyncError: error });
  },

  markSynced: (ids) => {
    set((s) => {
      const idSet = new Set(ids);
      const records = s.records.map((r) =>
        idSet.has(r.id) ? { ...r, cloudSynced: true } : r,
      );
      const next = new Set(s.pendingSyncIds);
      const syncErrors = new Map(s.syncErrors);
      for (const id of ids) {
        next.delete(id);
        syncErrors.delete(id);
      }
      return {
        records,
        pendingSyncIds: next,
        syncErrors,
        lastSyncAt: Date.now(),
      };
    });
  },

  markSyncFailed: (id, error) => {
    set((s) => {
      const syncErrors = new Map(s.syncErrors);
      syncErrors.set(id, error);
      return { syncErrors };
    });
  },

  markCloudDeleted: (ids) => {
    set((s) => {
      const next = new Set(s.pendingDeleteIds);
      for (const id of ids) next.delete(id);
      return { pendingDeleteIds: next };
    });
  },

  markDirty: (id) => {
    set((s) => {
      if (s.pendingSyncIds.has(id) && !s.syncErrors.has(id)) return s;
      return dirtied(s, id);
    });
  },

  resetDemoData: async () => {
    // Finish the stored-history read first so it cannot land after the
    // rewrite and bring the dropped demo records back into memory.
    await idb.ensureLoaded();
    const keep = (r: FlightRecord) => !r.id.startsWith("demo-");
    try {
      const stored = ((await idbGet(IDB_HISTORY_KEY)) ?? []) as FlightRecord[];
      await idbSet(IDB_HISTORY_KEY, Array.isArray(stored) ? stored.filter(keep) : []);
      // Drop demo telemetry recordings (id prefix "demo-rec-").
      const allKeys = await idbKeys();
      const demoKeys = allKeys.filter(
        (k): k is string =>
          typeof k === "string" && k.startsWith(`${IDB_RECORDINGS_PREFIX}demo-rec-`),
      );
      for (const k of demoKeys) await idbDel(k);
      const index = ((await idbGet(IDB_RECORDINGS_INDEX)) ?? []) as Array<{ id: string }>;
      const filtered = index.filter((r) => !r.id.startsWith("demo-rec-"));
      await idbSet(IDB_RECORDINGS_INDEX, filtered);
    } catch (err) {
      console.warn("[history-store] resetDemoData failed", err);
    }
    set((s) => ({ records: s.records.filter(keep), _seeded: false }));
  },

  setLogEntries: (droneId, entries) => {
    set((s) => {
      const map = new Map(s.logEntries);
      map.set(droneId, entries);
      return { logEntries: map };
    });
  },

  setIsLoadingLogList: (v) => set({ isLoadingLogList: v }),

  startLogDownload: (logId, totalSize) => {
    set({
      logDownload: {
        logId,
        totalSize,
        receivedBytes: 0,
        data: new Uint8Array(totalSize),
      },
      isDownloadingLog: true,
    });
  },

  updateLogDownload: (receivedBytes, data) => {
    set((s) => {
      if (!s.logDownload) return s;
      return {
        logDownload: { ...s.logDownload, receivedBytes, data },
      };
    });
  },

  completeLogDownload: () => {
    set({ logDownload: null, isDownloadingLog: false });
  },

  cancelLogDownload: () => {
    set({ logDownload: null, isDownloadingLog: false });
  },
}));

const idb = createIdbStoreLoader("history-store", async () => {
  const stored = (await idbGet(IDB_HISTORY_KEY)) as FlightRecord[] | undefined;
  const tombstones = (await idbGet(IDB_TOMBSTONES_KEY)) as StoredTombstones | undefined;
  useHistoryStore.setState((s) => {
    const tombstoneIds = new Set([...(tombstones?.ids ?? []), ...s.tombstoneIds]);
    const pendingDeleteIds = new Set([...(tombstones?.pending ?? []), ...s.pendingDeleteIds]);
    if (!stored || !Array.isArray(stored)) return { tombstoneIds, pendingDeleteIds };
    // Merge with anything already in memory (a demo seed or a flight armed
    // before the read finished). Stored records win on id conflict.
    const existing = new Map(s.records.map((r) => [r.id, r] as const));
    for (const r of stored) existing.set(r.id, r);
    const merged = Array.from(existing.values()).sort(
      (a, b) => (b.startTime ?? b.date) - (a.startTime ?? a.date),
    );
    return { records: merged.slice(0, MAX_RECORDS), tombstoneIds, pendingDeleteIds };
  });
});
