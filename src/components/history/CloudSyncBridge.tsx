"use client";

/**
 * Bridge between the local history-store and the Convex
 * `cmd_flightLogs` table.
 *
 * Responsibilities:
 *  - On mount: when Convex is available + user is signed in, load every
 *    cloud row newer than the last successful sync and merge into the local
 *    store.
 *  - Watch the `pendingSyncIds` set; debounce 1 s; push every dirty row
 *    via the upsert mutation. On success, mark the rows synced.
 *  - Surface sync state via the existing history-store `syncStatus` field
 *    so the toolbar badge and per-row cloud icon can subscribe.
 *
 * Renders nothing — purely a side-effect mount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useMutation, useConvex, usePaginatedQuery } from "convex/react";
import { useHistoryStore } from "@/stores/history-store";
import { useAuthStore } from "@/stores/auth-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdFlightLogsApi } from "@/lib/cmd-flight-logs-api";
import { toCloudShape, fromCloudShape } from "./cloud-sync-shape";

const SYNC_DEBOUNCE_MS = 1000;
const CLOUD_PAGE_SIZE = 25;

/**
 * Public entry. `usePaginatedQuery` has no "skip" sentinel, so we gate
 * the hook-using inner component behind a Convex + auth availability
 * check. When either is missing the bridge renders nothing and no Convex
 * subscription is opened.
 */
export function CloudSyncBridge() {
  const convexAvailable = useConvexAvailable();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!convexAvailable || !isAuthenticated) return null;
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
  // We use `useConvex` to give imperative access for the debounced push loop.
  const convex = useConvex();
  void convex;
  void remove;

  const lastMergeAtRef = useRef<number>(0);
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
    lastMergeAtRef.current = Date.now();
  }, [cloudList]);

  // ── Debounced push of dirty records ──────────────────────────────
  useEffect(() => {
    const pushPending = async () => {
      const state = useHistoryStore.getState();
      const dirtyIds = Array.from(state.pendingSyncIds);
      if (dirtyIds.length === 0) return;

      state.setSyncStatus("syncing");
      const synced: string[] = [];
      try {
        for (const id of dirtyIds) {
          const row = state.records.find((r) => r.id === id);
          if (!row) continue;
          // Block in-progress rows from syncing — they're not finalized.
          if (row.status === "in_progress") continue;
          await upsert({ record: toCloudShape(row) as Parameters<typeof upsert>[0]["record"] });
          synced.push(id);
        }
        state.markSynced(synced);
      } catch (err) {
        console.warn("[CloudSyncBridge] push failed", err);
        state.setSyncStatus("error", (err as Error).message);
      }
    };

    // Subscribe to history-store changes; debounce → push.
    const unsubscribe = useHistoryStore.subscribe((s, prev) => {
      if (s.pendingSyncIds === prev.pendingSyncIds) return;
      if (s.pendingSyncIds.size === 0) return;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      pushTimerRef.current = setTimeout(() => {
        void pushPending();
      }, SYNC_DEBOUNCE_MS);
    });

    // Run once on mount in case state was already dirty.
    void pushPending();

    return () => {
      unsubscribe();
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    };
  }, [upsert]);

  return null;
}
