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

interface HistoryState {
  records: FlightRecord[];
  logEntries: Map<string, LogEntry[]>;
  logDownload: LogDownloadState | null;
  isLoadingLogList: boolean;
  isDownloadingLog: boolean;
  _seeded: boolean;
  _loadedFromIdb: boolean;
}

interface HistoryActions {
  /** One-time init from mock/history.ts seed data. */
  initWithSeedData: (records: FlightRecord[]) => void;
  /** Prepend a new flight record (cap at 500). */
  addRecord: (record: FlightRecord) => void;
  /** Patch an existing record by id. Sets `updatedAt`. Noop if not found. */
  updateRecord: (id: string, patch: Partial<FlightRecord>) => void;
  /** Remove a record by id. */
  removeRecord: (id: string) => void;
  /** Async: load persisted records from IndexedDB. Idempotent. */
  loadFromIDB: () => Promise<void>;
  /** Async: write current records to IndexedDB. */
  persistToIDB: () => Promise<void>;
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
    set((s) => ({
      records: [record, ...s.records].slice(0, MAX_RECORDS),
    }));
  },

  updateRecord: (id, patch) => {
    set((s) => {
      let changed = false;
      const records = s.records.map((r) => {
        if (r.id !== id) return r;
        changed = true;
        return { ...r, ...patch, updatedAt: Date.now() };
      });
      return changed ? { records } : s;
    });
  },

  removeRecord: (id) => {
    set((s) => ({ records: s.records.filter((r) => r.id !== id) }));
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
      await idbSet(IDB_HISTORY_KEY, get().records);
    } catch (err) {
      console.warn("[history-store] persistToIDB failed", err);
    }
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
