/**
 * History store — central source of truth for all flight records.
 *
 * Holds mock seed data + live-recorded flights + real log entries.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type { FlightRecord } from "@/lib/types";

const IDB_HISTORY_KEY = "altcmd:flight-history";
const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";

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
  _loadedFromIdb: boolean;

  // Phase 9 — cloud sync bookkeeping. The Convex client is injected from
  // the React layer (CloudSyncBridge); the store stays Zustand-only.
  syncStatus: CloudSyncStatus;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  /** clientIds dirty since the last successful upsert. */
  pendingSyncIds: Set<string>;
}

interface HistoryActions {
  /** One-time init from mock/history.ts seed data. */
  initWithSeedData: (records: FlightRecord[]) => void;
  /** Prepend a new flight record (cap at 500). Marks the row dirty for cloud sync. */
  addRecord: (record: FlightRecord) => void;
  /** Patch an existing record by id. Sets `updatedAt` and marks dirty. Noop if not found. */
  updateRecord: (id: string, patch: Partial<FlightRecord>) => void;
  /** Remove a record by id. Marks for tombstone delete on next sync. */
  removeRecord: (id: string) => void;
  /** Async: load persisted records from IndexedDB. Idempotent. */
  loadFromIDB: () => Promise<void>;
  /** Async: write current records to IndexedDB. */
  persistToIDB: () => Promise<void>;
  /**
   * Phase 9 — merge a list of cloud records into the local store. Last-write-
   * wins on `updatedAt`. Records that exist locally but not in cloud stay put.
   * Returns the count of records that were updated by the merge.
   */
  mergeCloudRecords: (cloudRecords: FlightRecord[]) => number;
  /** Phase 9 — set the global sync status. */
  setSyncStatus: (status: CloudSyncStatus, error?: string | null) => void;
  /** Phase 9 — record a successful sync timestamp + clear dirty set. */
  markSynced: (ids: string[]) => void;
  /** Phase 9 — explicitly mark a clientId as dirty (re-sync next pass). */
  markDirty: (id: string) => void;
  /**
   * Async: clear all flight records and demo telemetry recordings from
   * memory + IndexedDB. Used by the History page in demo mode when the
   * seeded dataset version changes, to drop stale records before re-seeding.
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

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  records: [],
  logEntries: new Map(),
  logDownload: null,
  isLoadingLogList: false,
  isDownloadingLog: false,
  _seeded: false,
  _loadedFromIdb: false,
  syncStatus: "idle",
  lastSyncAt: null,
  lastSyncError: null,
  pendingSyncIds: new Set<string>(),

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
    set((s) => {
      const next = new Set(s.pendingSyncIds);
      next.add(record.id);
      return {
        records: [{ ...record, cloudSynced: false }, ...s.records].slice(0, MAX_RECORDS),
        pendingSyncIds: next,
      };
    });
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
      const next = new Set(s.pendingSyncIds);
      next.add(id);
      return { records, pendingSyncIds: next };
    });
  },

  removeRecord: (id) => {
    set((s) => {
      const next = new Set(s.pendingSyncIds);
      // Drop the dirty marker — caller is responsible for any tombstone push.
      next.delete(id);
      return {
        records: s.records.filter((r) => r.id !== id),
        pendingSyncIds: next,
      };
    });
  },

  loadFromIDB: async () => {
    if (get()._loadedFromIdb) return;
    try {
      const stored = (await idbGet(IDB_HISTORY_KEY)) as FlightRecord[] | undefined;
      if (stored && Array.isArray(stored)) {
        // Merge with anything already in memory (e.g. demo seed that ran first).
        const existing = new Map(get().records.map((r) => [r.id, r] as const));
        for (const r of stored) existing.set(r.id, r); // IDB wins on conflict
        const merged = Array.from(existing.values()).sort(
          (a, b) => (b.startTime ?? b.date) - (a.startTime ?? a.date),
        );
        set({ records: merged.slice(0, MAX_RECORDS), _loadedFromIdb: true });
      } else {
        set({ _loadedFromIdb: true });
      }
    } catch (err) {
      console.warn("[history-store] loadFromIDB failed", err);
      set({ _loadedFromIdb: true });
    }
  },

  persistToIDB: async () => {
    try {
      // Demo seed records (id prefix "demo-") are reseeded on every demo
      // mode load and must never pollute IDB. Real imports, dataflash logs,
      // and live-hardware flights use other id schemes and persist normally.
      const clean = get().records.filter((r) => !r.id.startsWith("demo-"));
      await idbSet(IDB_HISTORY_KEY, clean);
    } catch (err) {
      console.warn("[history-store] persistToIDB failed", err);
    }
  },

  mergeCloudRecords: (cloudRecords) => {
    let updatedCount = 0;
    set((s) => {
      const localById = new Map(s.records.map((r) => [r.id, r] as const));
      for (const remote of cloudRecords) {
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
      for (const id of ids) next.delete(id);
      return {
        records,
        pendingSyncIds: next,
        lastSyncAt: Date.now(),
        syncStatus: "idle" as const,
        lastSyncError: null,
      };
    });
  },

  markDirty: (id) => {
    set((s) => {
      if (s.pendingSyncIds.has(id)) return s;
      const next = new Set(s.pendingSyncIds);
      next.add(id);
      return { pendingSyncIds: next };
    });
  },

  resetDemoData: async () => {
    try {
      await idbDel(IDB_HISTORY_KEY);
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
    set({ records: [], _seeded: false, _loadedFromIdb: false });
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
