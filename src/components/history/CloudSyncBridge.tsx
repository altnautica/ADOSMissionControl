"use client";

/**
 * Bridge between the local history-store and the Convex
 * `cmd_flightLogs` table.
 *
 * Responsibilities:
 *  - On mount: when Convex is available + user is signed in, load every
 *    cloud row newer than the last successful sync and merge into the local
 *    store. Tombstoned (permanently deleted) ids are never merged back.
 *  - Watch the `pendingSyncIds` and `pendingDeleteIds` sets; debounce 1 s;
 *    remove every tombstoned row and push every dirty row. Each record
 *    succeeds or fails on its own: successes are marked synced, a refused
 *    record is quarantined with its error and the rest carry on.
 *  - Retry whatever is still pending on a fixed interval while signed in.
 *  - Surface sync state via the existing history-store `syncStatus` field
 *    so the toolbar badge and per-row cloud icon can subscribe.
 *
 * Renders nothing — purely a side-effect mount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useHistoryStore } from "@/stores/history-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { cmdFlightLogsApi } from "@/lib/cmd-flight-logs-api";
import { toCloudShape, fromCloudShape } from "./cloud-sync-shape";

const SYNC_DEBOUNCE_MS = 1000;
/** Fixed cadence for retrying rows still pending after a pass. */
const SYNC_RETRY_MS = 3000;
const CLOUD_PAGE_SIZE = 25;

/**
 * Public entry. `usePaginatedQuery` has no "skip" sentinel, so we gate
 * the hook-using inner component behind a Convex + auth availability
 * check. When either is missing, or demo mode is on, the bridge renders
 * nothing and no Convex subscription is opened.
 */
export function CloudSyncBridge() {
  const convexAvailable = useConvexAvailable();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const demoMode = useSettingsStore((s) => s.demoMode);
  if (!convexAvailable || !isAuthenticated || demoMode) return null;
  return <CloudSyncBridgeInner />;
}

function CloudSyncBridgeInner() {
  // Paginated cloud list. Walk every page on mount so the local store
  // converges with the cloud, then keep pages reactive for cross-device
  // updates.
  const {
    results: cloudList,
    status: cloudStatus,
    loadMore,
  } = usePaginatedQuery(
    cmdFlightLogsApi.listPaginated,
    {},
    { initialNumItems: CLOUD_PAGE_SIZE },
  );

  const upsert = useMutation(cmdFlightLogsApi.upsert);
  const remove = useMutation(cmdFlightLogsApi.remove);

  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-walk pages until exhausted ──────────────────────────────
  // Cloud-sync semantics require every row to land in the local store.
  // Walk forward as long as more pages exist; pagination still wins on
  // memory because each page renders/merges independently and the Convex
  // subscription transport never holds the whole list in one frame.
  useEffect(() => {
    if (cloudStatus === "CanLoadMore") {
      loadMore(CLOUD_PAGE_SIZE);
    }
  }, [cloudStatus, loadMore]);

  // ── Reactive merge: any cloud-side change flows in here ──────────
  useEffect(() => {
    if (cloudList.length === 0) return;
    const records = cloudList.map(fromCloudShape);
    const updated = useHistoryStore.getState().mergeCloudRecords(records);
    if (updated > 0) {
      void useHistoryStore.getState().persistToIDB();
    }
  }, [cloudList]);

  // ── Debounced push of dirty records and tombstones ───────────────
  useEffect(() => {
    let running = false;

    const pushPending = async () => {
      if (running) return;
      const state = useHistoryStore.getState();
      // Demo seed records (id prefix "demo-") never leave the browser.
      const deleteIds = Array.from(state.pendingDeleteIds).filter((id) => !id.startsWith("demo-"));
      const pushable = state.records
        // Quarantined rows wait for an edit or a manual retry; in-progress
        // rows are not finalized yet.
        .filter((r) => state.pendingSyncIds.has(r.id) && !state.syncErrors.has(r.id))
        .filter((r) => r.status !== "in_progress" && !r.id.startsWith("demo-"))
        .map((r) => r.id);
      if (deleteIds.length === 0 && pushable.length === 0) return;

      running = true;
      state.setSyncStatus("syncing");
      const synced: string[] = [];
      const removed: string[] = [];
      let deleteError: string | null = null;
      try {
        for (const clientId of deleteIds) {
          try {
            await remove({ clientId });
            removed.push(clientId);
          } catch (err) {
            console.warn("[CloudSyncBridge] delete failed", clientId, err);
            deleteError ??= (err as Error).message;
          }
        }
        for (const id of pushable) {
          // Push the row as it is now, not as it was when the pass started.
          const row = useHistoryStore.getState().records.find((r) => r.id === id);
          if (!row) continue;
          try {
            await upsert({ record: toCloudShape(row) as Parameters<typeof upsert>[0]["record"] });
            // An edit that landed during the upsert stays dirty for the next pass.
            const now = useHistoryStore.getState().records.find((r) => r.id === id);
            if (now?.updatedAt === row.updatedAt) synced.push(id);
          } catch (err) {
            console.warn("[CloudSyncBridge] push refused", id, err);
            useHistoryStore.getState().markSyncFailed(id, (err as Error).message);
          }
        }
      } finally {
        const store = useHistoryStore.getState();
        if (removed.length > 0) {
          store.markCloudDeleted(removed);
          void store.persistToIDB();
        }
        if (synced.length > 0) store.markSynced(synced);
        const refusal = useHistoryStore.getState().syncErrors.values().next().value ?? null;
        const error = deleteError ?? refusal;
        store.setSyncStatus(error ? "error" : "idle", error);
        running = false;
      }
    };

    // Subscribe to history-store changes; debounce → push.
    const unsubscribe = useHistoryStore.subscribe((s, prev) => {
      if (s.pendingSyncIds === prev.pendingSyncIds && s.pendingDeleteIds === prev.pendingDeleteIds) return;
      if (s.pendingSyncIds.size === 0 && s.pendingDeleteIds.size === 0) return;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(() => {
        void pushPending();
      }, SYNC_DEBOUNCE_MS);
    });

    // Run once on mount in case state was already dirty, then keep retrying
    // whatever is still pending (in-progress rows, transient failures).
    void pushPending();
    const retry = setInterval(() => {
      void pushPending();
    }, SYNC_RETRY_MS);

    return () => {
      unsubscribe();
      clearInterval(retry);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [upsert, remove]);

  return null;
}
