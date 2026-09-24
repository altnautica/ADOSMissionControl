/**
 * @module pluginRecords
 * @description Plugin-owned cloud records.
 *
 * A plugin stores small JSON documents under the operator's account, keyed by
 * `(collection, key)` inside its own namespace. The GCS host calls `list`,
 * `get`, `put` and `remove` on the plugin's behalf, binding `pluginId` from
 * the mounted plugin rather than from plugin input; the agent half writes
 * through `POST /agent/plugin-records` into `ingestFromAgent`.
 *
 * Every access needs an enabled install of the plugin with the
 * `cloud.records` grant. A record body is capped at 64 KiB of JSON and a
 * plugin at 5000 records per user; `plugin_record_counts` keeps the live
 * count so the cap costs one read.
 *
 * Failures raise a `ConvexError` whose data is `{ code }`, one of
 * `unauthenticated`, `not_permitted`, `invalid_args`, `too_large`,
 * `limit_reached`, so the host can hand the plugin a typed reason.
 *
 * @license GPL-3.0-only
 */

import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  CLOUD_RECORDS_CAPABILITY,
  MAX_RECORD_BYTES,
  MAX_RECORDS_PER_PLUGIN,
  isValidCollection,
  isValidPluginId,
  isValidRecordKey,
  recordDataBytes,
} from "./lib/pluginRecordsIngest";

/** Default and largest page a `list` returns. 100 x 64 KiB stays under the read limit. */
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

/**
 * Records deleted per transaction by a purge. Bounded by bytes read: a batch
 * of maximum-size records stays well under the per-transaction read limit.
 */
export const RECORD_PURGE_BATCH = 64;

/** A record as a plugin sees it. */
export interface PluginRecordView {
  collection: string;
  key: string;
  deviceId: string | null;
  data: unknown;
  updatedAt: number;
  writtenBy: "gcs" | "agent";
}

type RecordErrorCode =
  | "unauthenticated"
  | "not_permitted"
  | "invalid_args"
  | "too_large"
  | "limit_reached";

function fail(code: RecordErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

function toView(row: Doc<"plugin_records">): PluginRecordView {
  return {
    collection: row.collection,
    key: row.key,
    deviceId: row.deviceId ?? null,
    data: row.data,
    updatedAt: row.updatedAt,
    writtenBy: row.writtenBy,
  };
}

function isActiveInstall(install: Doc<"cmd_pluginInstalls">): boolean {
  return install.status === "enabled" || install.status === "running";
}

/**
 * Whether the user holds an enabled install of `pluginId` (on any node, or
 * GCS-only) with `cloud.records` granted.
 */
async function gcsGrantHeld(
  ctx: QueryCtx,
  userId: string,
  pluginId: string,
): Promise<boolean> {
  const perms = await ctx.db
    .query("cmd_pluginPermissions")
    .withIndex("by_user_plugin", (q) => q.eq("userId", userId).eq("pluginId", pluginId))
    .collect();
  for (const perm of perms) {
    if (perm.permissionId !== CLOUD_RECORDS_CAPABILITY || !perm.granted) continue;
    const install = await ctx.db.get(perm.pluginInstallId);
    if (install && install.userId === userId && isActiveInstall(install)) return true;
  }
  return false;
}

/**
 * Whether the node `deviceId` carries an enabled install of `pluginId` for
 * `userId` with `cloud.records` granted: the agent half's consent.
 */
async function agentGrantHeld(
  ctx: QueryCtx,
  userId: string,
  deviceId: string,
  pluginId: string,
): Promise<boolean> {
  const install = await ctx.db
    .query("cmd_pluginInstalls")
    .withIndex("by_user_drone_plugin", (q) =>
      q.eq("userId", userId).eq("droneId", deviceId).eq("pluginId", pluginId),
    )
    .first();
  if (!install || !isActiveInstall(install)) return false;
  const perm = await ctx.db
    .query("cmd_pluginPermissions")
    .withIndex("by_install_perm", (q) =>
      q.eq("pluginInstallId", install._id).eq("permissionId", CLOUD_RECORDS_CAPABILITY),
    )
    .first();
  return perm?.granted === true;
}

/** Authenticated caller with the GCS grant for `pluginId`, or a typed failure. */
async function requireGcsAccess(ctx: QueryCtx, pluginId: string): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) fail("unauthenticated", "sign in to use plugin records");
  if (!isValidPluginId(pluginId)) fail("invalid_args", "pluginId must be a reverse-DNS id");
  if (!(await gcsGrantHeld(ctx, userId, pluginId))) {
    fail("not_permitted", `${pluginId} has no enabled install with ${CLOUD_RECORDS_CAPABILITY}`);
  }
  return userId;
}

function requireAddress(collection: string, key?: string): void {
  if (!isValidCollection(collection)) {
    fail("invalid_args", "collection must be 1-64 of [a-z0-9_.-]");
  }
  if (key !== undefined && !isValidRecordKey(key)) {
    fail("invalid_args", "key must be 1-256 characters");
  }
}

async function findRecord(
  ctx: QueryCtx,
  userId: string,
  pluginId: string,
  collection: string,
  key: string,
): Promise<Doc<"plugin_records"> | null> {
  return await ctx.db
    .query("plugin_records")
    .withIndex("by_user_plugin_collection_key", (q) =>
      q.eq("userId", userId).eq("pluginId", pluginId).eq("collection", collection).eq("key", key),
    )
    .first();
}

async function adjustCount(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
  pluginId: string,
  delta: number,
): Promise<void> {
  const counter = await ctx.db
    .query("plugin_record_counts")
    .withIndex("by_user_plugin", (q) => q.eq("userId", userId).eq("pluginId", pluginId))
    .first();
  const next = Math.max(0, (counter?.count ?? 0) + delta);
  if (counter && next === 0) await ctx.db.delete(counter._id);
  else if (counter) await ctx.db.patch(counter._id, { count: next });
  else if (next > 0) await ctx.db.insert("plugin_record_counts", { userId, pluginId, count: next });
}

interface RecordWrite {
  userId: string;
  pluginId: string;
  collection: string;
  key: string;
  deviceId?: string;
  data: unknown;
  sizeBytes: number;
  writtenBy: "gcs" | "agent";
}

/**
 * Insert or replace one record. Returns `false` when a NEW key would take the
 * plugin past its record cap; replacing an existing key is always allowed.
 */
async function writeRecord(ctx: MutationCtx, write: RecordWrite): Promise<boolean> {
  const updatedAt = Date.now();
  const existing = await findRecord(ctx, write.userId, write.pluginId, write.collection, write.key);
  if (existing) {
    await ctx.db.patch(existing._id, {
      deviceId: write.deviceId,
      data: write.data,
      sizeBytes: write.sizeBytes,
      writtenBy: write.writtenBy,
      updatedAt,
    });
    return true;
  }
  const counter = await ctx.db
    .query("plugin_record_counts")
    .withIndex("by_user_plugin", (q) => q.eq("userId", write.userId).eq("pluginId", write.pluginId))
    .first();
  if ((counter?.count ?? 0) >= MAX_RECORDS_PER_PLUGIN) return false;
  await ctx.db.insert("plugin_records", { ...write, updatedAt });
  await adjustCount(ctx, write.userId, write.pluginId, 1);
  return true;
}

/** Delete record rows and keep the per-plugin counts in step. */
async function deleteRecordRows(
  ctx: Pick<MutationCtx, "db">,
  rows: ReadonlyArray<Doc<"plugin_records">>,
): Promise<void> {
  const deltas = new Map<string, { userId: string; pluginId: string; n: number }>();
  for (const row of rows) {
    await ctx.db.delete(row._id);
    const scope = `${row.userId}\u0000${row.pluginId}`;
    const entry = deltas.get(scope) ?? { userId: row.userId, pluginId: row.pluginId, n: 0 };
    entry.n += 1;
    deltas.set(scope, entry);
  }
  for (const { userId, pluginId, n } of deltas.values()) {
    await adjustCount(ctx, userId, pluginId, -n);
  }
}

/**
 * Delete up to `limit` of one device's records, across every user and plugin.
 * Used by the device wipe; `truncated` means another pass is needed.
 */
export async function deleteDeviceRecords(
  ctx: Pick<MutationCtx, "db">,
  deviceId: string,
  limit: number,
): Promise<{ removed: number; truncated: boolean }> {
  const rows = await ctx.db
    .query("plugin_records")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .take(limit + 1);
  const batch = rows.slice(0, limit);
  await deleteRecordRows(ctx, batch);
  return { removed: batch.length, truncated: rows.length > limit };
}

/** One purge scope: a user's records of one plugin, optionally for one device. */
interface PurgeScope {
  userId: string;
  pluginId: string;
  deviceId?: string;
}

async function purgeBatch(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  scope: PurgeScope,
): Promise<void> {
  const { userId, pluginId, deviceId } = scope;
  const rows =
    deviceId === undefined
      ? await ctx.db
          .query("plugin_records")
          .withIndex("by_user_plugin_collection_key", (q) =>
            q.eq("userId", userId).eq("pluginId", pluginId),
          )
          .take(RECORD_PURGE_BATCH + 1)
      : await ctx.db
          .query("plugin_records")
          .withIndex("by_user_plugin_device", (q) =>
            q.eq("userId", userId).eq("pluginId", pluginId).eq("deviceId", deviceId),
          )
          .take(RECORD_PURGE_BATCH + 1);
  await deleteRecordRows(ctx, rows.slice(0, RECORD_PURGE_BATCH));
  if (rows.length > RECORD_PURGE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.pluginRecords.purgeScope, scope);
  }
}

/**
 * Drop the records an uninstalled plugin leaves behind. Removing the user's
 * last install of the plugin drops all of its records; removing one node's
 * install while others remain drops only the records about that node.
 * Continues in scheduled batches when there are more than one transaction
 * should delete.
 */
export async function purgeRecordsForRemovedInstall(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  install: Doc<"cmd_pluginInstalls">,
): Promise<void> {
  const installs = await ctx.db
    .query("cmd_pluginInstalls")
    .withIndex("by_user", (q) => q.eq("userId", install.userId))
    .collect();
  const othersRemain = installs.some(
    (row) => row.pluginId === install.pluginId && row._id !== install._id,
  );
  if (!othersRemain) {
    await purgeBatch(ctx, { userId: install.userId, pluginId: install.pluginId });
  } else if (install.droneId) {
    await purgeBatch(ctx, {
      userId: install.userId,
      pluginId: install.pluginId,
      deviceId: install.droneId,
    });
  }
}

/** Continuation of a purge that did not fit one transaction. */
export const purgeScope = internalMutation({
  args: { userId: v.string(), pluginId: v.string(), deviceId: v.optional(v.string()) },
  handler: async (ctx, scope): Promise<void> => {
    await purgeBatch(ctx, scope);
  },
});

// ──────────────────────────────────────────────────────────────
// GCS host access
// ──────────────────────────────────────────────────────────────

/** A page of one collection, in key order, optionally only one device's. */
export const list = query({
  args: {
    pluginId: v.string(),
    collection: v.string(),
    deviceId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PluginRecordView[]> => {
    const userId = await requireGcsAccess(ctx, args.pluginId);
    requireAddress(args.collection);
    const limit = Math.min(
      LIST_MAX_LIMIT,
      Math.max(1, Math.floor(args.limit ?? LIST_DEFAULT_LIMIT)),
    );
    const rows =
      args.deviceId === undefined
        ? await ctx.db
            .query("plugin_records")
            .withIndex("by_user_plugin_collection_key", (q) =>
              q.eq("userId", userId).eq("pluginId", args.pluginId).eq("collection", args.collection),
            )
            .take(limit)
        : await ctx.db
            .query("plugin_records")
            .withIndex("by_user_plugin_device", (q) =>
              q.eq("userId", userId).eq("pluginId", args.pluginId).eq("deviceId", args.deviceId),
            )
            .filter((q) => q.eq(q.field("collection"), args.collection))
            .take(limit);
    return rows.map(toView);
  },
});

/** One record, or null. */
export const get = query({
  args: { pluginId: v.string(), collection: v.string(), key: v.string() },
  handler: async (ctx, args): Promise<PluginRecordView | null> => {
    const userId = await requireGcsAccess(ctx, args.pluginId);
    requireAddress(args.collection, args.key);
    const row = await findRecord(ctx, userId, args.pluginId, args.collection, args.key);
    return row ? toView(row) : null;
  },
});

/** Insert or replace one record, written by the GCS half. */
export const put = mutation({
  args: {
    pluginId: v.string(),
    collection: v.string(),
    key: v.string(),
    data: v.any(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const userId = await requireGcsAccess(ctx, args.pluginId);
    requireAddress(args.collection, args.key);
    const sizeBytes = recordDataBytes(args.data);
    if (sizeBytes === null) fail("invalid_args", "data must be JSON");
    if (sizeBytes > MAX_RECORD_BYTES) fail("too_large", `data exceeds ${MAX_RECORD_BYTES} bytes`);
    const deviceId = args.deviceId;
    if (deviceId !== undefined) {
      // A record may only name a node the caller owns, or a device wipe of
      // someone else's node would reach into this account's records.
      const drone = await ctx.db
        .query("cmd_drones")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .first();
      if (!drone || drone.userId !== userId) fail("not_permitted", "deviceId is not in this fleet");
    }
    const written = await writeRecord(ctx, {
      userId,
      pluginId: args.pluginId,
      collection: args.collection,
      key: args.key,
      deviceId: args.deviceId,
      data: args.data,
      sizeBytes,
      writtenBy: "gcs",
    });
    if (!written) fail("limit_reached", `a plugin holds at most ${MAX_RECORDS_PER_PLUGIN} records`);
    return null;
  },
});

/** Delete one record. Deleting a missing key is a no-op. */
export const remove = mutation({
  args: { pluginId: v.string(), collection: v.string(), key: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const userId = await requireGcsAccess(ctx, args.pluginId);
    requireAddress(args.collection, args.key);
    const row = await findRecord(ctx, userId, args.pluginId, args.collection, args.key);
    if (row) await deleteRecordRows(ctx, [row]);
    return null;
  },
});

// ──────────────────────────────────────────────────────────────
// Agent ingest
// ──────────────────────────────────────────────────────────────

/**
 * Write one record posted by a plugin's agent half. The route has already
 * authenticated the poster and bounded the fields (lib/pluginRecordsIngest);
 * the poster node's install grant is checked here, in the write transaction.
 */
export const ingestFromAgent = internalMutation({
  args: {
    userId: v.string(),
    posterDeviceId: v.string(),
    pluginId: v.string(),
    collection: v.string(),
    key: v.string(),
    deviceId: v.string(),
    data: v.any(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args): Promise<"ok" | "not_permitted" | "limit_reached"> => {
    if (!(await agentGrantHeld(ctx, args.userId, args.posterDeviceId, args.pluginId))) {
      return "not_permitted";
    }
    const written = await writeRecord(ctx, {
      userId: args.userId,
      pluginId: args.pluginId,
      collection: args.collection,
      key: args.key,
      deviceId: args.deviceId,
      data: args.data,
      sizeBytes: args.sizeBytes,
      writtenBy: "agent",
    });
    return written ? "ok" : "limit_reached";
  },
});
