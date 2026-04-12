"use client";

/**
 * Phase 9 — bridge between the local history-store and the Convex
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
import { useMutation, useQuery, useConvex } from "convex/react";
import { useHistoryStore } from "@/stores/history-store";
import { useAuthStore } from "@/stores/auth-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdFlightLogsApi } from "@/lib/cmd-flight-logs-api";
import type { FlightRecord } from "@/lib/types";

const SYNC_DEBOUNCE_MS = 1000;

/**
 * Strip non-schema fields before sending to the server. The Convex validator
 * rejects any extra keys, so the local-only `cloudSynced` flag must be
 * removed.
 */
function toCloudShape(record: FlightRecord): Omit<FlightRecord, "cloudSynced"> & { clientId: string } {
  // Map the record-store `id` field to the cloud-side `clientId`.
  const { id, cloudSynced: _cloudSynced, ...rest } = record;
  void _cloudSynced;
  return { ...rest, clientId: id } as unknown as Omit<FlightRecord, "cloudSynced"> & { clientId: string };
}

/**
 * Translate a cloud row (which uses `clientId` + `_id` + `_creationTime`)
 * back into the local FlightRecord shape.
 */
function fromCloudShape(row: Record<string, unknown>): FlightRecord {
  const { _id, _creationTime, userId, clientId, ...rest } = row as Record<string, unknown> & {
    clientId: string;
  };
  void _id;
  void _creationTime;
  void userId;
  return { ...rest, id: clientId } as unknown as FlightRecord;
}

export function CloudSyncBridge() {
  const convexAvailable = useConvexAvailable();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Disable hooks entirely when Convex / auth aren't ready.
  const enabled = convexAvailable && isAuthenticated;

  // Reactive query — Convex `useQuery` returns undefined until first result.
  // Pass "skip" sentinel when disabled to avoid context errors per CLAUDE.md
  // gotcha. We don't use the existing `useConvexSkipQuery` helper because we
  // want the raw reactive subscription (it pushes updates from other tabs).
  const cloudList = useQuery(
    cmdFlightLogsApi.list,
    enabled ? {} : "skip",
  ) as Record<string, unknown>[] | undefined;

  const upsert = useMutation(cmdFlightLogsApi.upsert);
  const remove = useMutation(cmdFlightLogsApi.remove);
  // We use `useConvex` to give imperative access for the debounced push loop.
  const convex = useConvex();
  void convex;
  void remove;

  const lastMergeAtRef = useRef<number>(0);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Reactive merge: any cloud-side change flows in here ──────────
  useEffect(() => {
    if (!enabled) return;
    if (!cloudList) return;
    const records = cloudList.map(fromCloudShape);
    const updated = useHistoryStore.getState().mergeCloudRecords(records);
    if (updated > 0) {
      void useHistoryStore.getState().persistToIDB();
    }
    lastMergeAtRef.current = Date.now();
  }, [enabled, cloudList]);

  // ── Debounced push of dirty records ──────────────────────────────
  useEffect(() => {
    if (!enabled) return;

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
  }, [enabled, upsert]);

  return null;
}
