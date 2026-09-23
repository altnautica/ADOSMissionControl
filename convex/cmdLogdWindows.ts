/**
 * @module cmdLogdWindows
 * @description Registry for explicitly exported on-device log windows.
 * The agent's durable local log store is the source of truth; an
 * operator can push a chosen window (a session, or a closed time
 * range, for one record kind) to the paired cloud account as a
 * revocable export. One row per stored blob.
 *
 * Ingest path (one authenticated binary POST, mirrors the heartbeat
 * route's header-auth + `ctx.storage.store(blob)` pattern):
 *
 *   1. The HTTP route reads the device API key + window metadata from
 *      headers, validates the key against the paired device, stores
 *      the raw body blob in Convex storage, and calls `ingestWindow`.
 *   2. `ingestWindow` re-reads the stored bytes, recomputes the
 *      authoritative SHA-256 (never trusting a client claim), and
 *      hands off to `insertWindow`.
 *   3. `insertWindow` resolves the owner from the paired device,
 *      dedups on (deviceId, contentHash). A re-push of the same
 *      deterministic window finds the existing row, deletes the
 *      redundant blob, and returns the original window id so the
 *      caller can still mark the source rows synced.
 *
 * Integrity is enforced server-side: `contentHash` is the SHA-256 the
 * server computed from the stored bytes, and `userId` is copied from
 * the paired device record, not from any client value.
 *
 * Reads are account-gated: `getLogdWindows` and `getLogdWindow` both
 * require the authenticated user to own the device, mirroring the
 * cloud-relay drone-ownership guard.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwnedDroneByDeviceId } from "./cmdDroneAccess";

// Cap on a single window blob we will store + re-hash. Matches the
// route-level cap so the action never re-hashes an oversized blob the
// route already rejected.
const WINDOW_MAX_BYTES = 32 * 1024 * 1024;

// Accepted export encodings. The agent streams the same bytes it read
// from the local store's export endpoint.
const ALLOWED_FORMATS = new Set(["jsonl.zst", "jsonl"]);

// The window-summary shape returned to operators. Excludes `storageId`
// and `userId` so the list cannot leak the blob handle or the owner.
const windowSummaryValidator = v.object({
  _id: v.id("logd_windows"),
  _creationTime: v.number(),
  deviceId: v.string(),
  sessionId: v.string(),
  kind: v.string(),
  windowStartUs: v.number(),
  windowEndUs: v.number(),
  contentHash: v.string(),
  format: v.string(),
  rowCount: v.number(),
  sizeBytes: v.number(),
  pushedAt: v.number(),
});

type WindowSummary = {
  _id: Id<"logd_windows">;
  _creationTime: number;
  deviceId: string;
  sessionId: string;
  kind: string;
  windowStartUs: number;
  windowEndUs: number;
  contentHash: string;
  format: string;
  rowCount: number;
  sizeBytes: number;
  pushedAt: number;
};

type IngestResult = {
  status: "inserted" | "duplicate";
  windowId: Id<"logd_windows">;
  contentHash: string;
};

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Ingest (called from the HTTP route after the device key is checked)
// ──────────────────────────────────────────────────────────────

/**
 * Re-read the stored window blob, recompute the authoritative SHA-256
 * + byte size, and insert (or dedup) the registry row. Called from the
 * `/agent/logd/window` HTTP action after it has stored the blob and
 * verified the device API key. On any validation failure the freshly
 * stored blob is deleted so a rejected upload never orphans storage.
 */
export const ingestWindow = internalAction({
  args: {
    deviceId: v.string(),
    sessionId: v.string(),
    kind: v.string(),
    windowStartUs: v.number(),
    windowEndUs: v.number(),
    format: v.string(),
    rowCount: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<IngestResult> => {
    if (!ALLOWED_FORMATS.has(args.format)) {
      await ctx.storage.delete(args.storageId);
      throw new Error(`unsupported window format: ${args.format}`);
    }

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("stored window blob missing");
    }
    const bytes = await blob.arrayBuffer();
    const sizeBytes = bytes.byteLength;
    if (sizeBytes === 0 || sizeBytes > WINDOW_MAX_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("window too large or empty");
    }

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = toHex(digest);

    const result = await ctx.runMutation(internal.cmdLogdWindows.insertWindow, {
      deviceId: args.deviceId,
      sessionId: args.sessionId,
      kind: args.kind,
      windowStartUs: args.windowStartUs,
      windowEndUs: args.windowEndUs,
      format: args.format,
      rowCount: args.rowCount,
      sizeBytes,
      contentHash,
      storageId: args.storageId,
    });
    return { status: result.status, windowId: result.windowId, contentHash };
  },
});

/**
 * Internal insert. Called only by `ingestWindow` after the bytes have
 * been re-hashed. Resolves the owner from the paired device, refuses
 * an unpaired device, and dedups on (deviceId, contentHash). Carries
 * the server-computed hash + size so the row's contents are not
 * derived from any client value.
 */
export const insertWindow = internalMutation({
  args: {
    deviceId: v.string(),
    sessionId: v.string(),
    kind: v.string(),
    windowStartUs: v.number(),
    windowEndUs: v.number(),
    format: v.string(),
    rowCount: v.number(),
    sizeBytes: v.number(),
    contentHash: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "inserted" | "duplicate"; windowId: Id<"logd_windows"> }> => {
    // Resolve the owner from the paired device record. An unpaired
    // device cannot own an exported window; drop the blob and refuse.
    const drone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!drone) {
      await ctx.storage.delete(args.storageId);
      throw new Error("device is not paired");
    }

    // Dedup: same (deviceId, contentHash) means the same deterministic
    // window was pushed before. Reuse the existing row and drop the
    // redundant blob so a retry is a no-op.
    const existing = await ctx.db
      .query("logd_windows")
      .withIndex("by_device_hash", (q) =>
        q.eq("deviceId", args.deviceId).eq("contentHash", args.contentHash),
      )
      .first();
    if (existing) {
      await ctx.storage.delete(args.storageId);
      return { status: "duplicate", windowId: existing._id };
    }

    const windowId = await ctx.db.insert("logd_windows", {
      userId: drone.userId,
      deviceId: args.deviceId,
      sessionId: args.sessionId,
      kind: args.kind,
      windowStartUs: args.windowStartUs,
      windowEndUs: args.windowEndUs,
      contentHash: args.contentHash,
      format: args.format,
      rowCount: args.rowCount,
      sizeBytes: args.sizeBytes,
      storageId: args.storageId,
      pushedAt: Date.now(),
    });
    return { status: "inserted", windowId };
  },
});

// ──────────────────────────────────────────────────────────────
// Operator reads (account-gated)
// ──────────────────────────────────────────────────────────────

// Upper bound on rows the list query returns. logd_windows is an
// operator-append table; an unbounded `.collect()` scales with total exports
// rather than what the review surface shows. The newest window is what the UI
// cares about; older windows remain reachable by the retention sweep / the
// per-window download action.
const MAX_WINDOW_LIST = 200;

/**
 * List the exported windows for a device the authenticated user owns,
 * newest first, bounded to the most recent {@link MAX_WINDOW_LIST}. The blob
 * handle (`storageId`) and owner (`userId`) are stripped from the returned
 * shape.
 */
export const getLogdWindows = query({
  args: { deviceId: v.string() },
  returns: v.array(windowSummaryValidator),
  handler: async (ctx, { deviceId }): Promise<WindowSummary[]> => {
    await requireOwnedDroneByDeviceId(ctx, deviceId);
    const rows = await ctx.db
      .query("logd_windows")
      .withIndex("by_device_pushedAt", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(MAX_WINDOW_LIST);
    return rows.map(({ storageId: _storageId, userId: _userId, ...rest }) => rest);
  },
});

/**
 * Internal read for the download action's ownership re-check. Returns
 * the full row (including `storageId`) so the action can mint a signed
 * URL; the action is responsible for the ownership comparison.
 */
export const getWindowInternal = internalQuery({
  args: { id: v.id("logd_windows") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * Mint a short-lived signed download URL for one exported window the
 * authenticated user owns. Ownership is re-checked server-side against
 * the row's denormalized `userId`. Optional in the operator flow; the
 * window list is the primary surface.
 */
export const getLogdWindow = action({
  args: { id: v.id("logd_windows") },
  handler: async (
    ctx,
    { id },
  ): Promise<{ url: string; window: WindowSummary }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.runQuery(internal.cmdLogdWindows.getWindowInternal, {
      id,
    });
    if (!row || row.userId !== userId) {
      throw new Error("Not found");
    }
    const url = await ctx.storage.getUrl(row.storageId);
    if (!url) throw new Error("window blob missing in storage");
    const window: WindowSummary = {
      _id: row._id,
      _creationTime: row._creationTime,
      deviceId: row.deviceId,
      sessionId: row.sessionId,
      kind: row.kind,
      windowStartUs: row.windowStartUs,
      windowEndUs: row.windowEndUs,
      contentHash: row.contentHash,
      format: row.format,
      rowCount: row.rowCount,
      sizeBytes: row.sizeBytes,
      pushedAt: row.pushedAt,
    };
    return { url, window };
  },
});

// ──────────────────────────────────────────────────────────────
// Retention sweep (cron-only)
// ──────────────────────────────────────────────────────────────

// How long an exported window is retained before the sweep deletes it.
const WINDOW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Per-tick delete cap so a large backlog cannot exceed the per-call limits.
const WINDOW_PRUNE_BATCH = 128;

/**
 * Retention sweep (cron-only): delete exported windows older than the
 * retention window so the append-only `logd_windows` table — and its stored
 * blobs — do not grow without bound. Walks the `by_pushedAt` index range so
 * the cost tracks what is being deleted, not the whole table; deletes the
 * underlying storage blob for each pruned row so the sweep never orphans
 * storage.
 */
export const pruneOldWindows = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - WINDOW_RETENTION_MS;
    const stale = await ctx.db
      .query("logd_windows")
      .withIndex("by_pushedAt", (q) => q.lt("pushedAt", cutoff))
      .take(WINDOW_PRUNE_BATCH);
    // The blob goes before the row: a failure part-way leaves a row pointing
    // at a missing blob (visible) rather than a blob nothing references.
    for (const row of stale) {
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
    }
    // A full batch means more may be past retention: keep draining now.
    if (stale.length === WINDOW_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdLogdWindows.pruneOldWindows, {});
    }
    return { deleted: stale.length };
  },
});
