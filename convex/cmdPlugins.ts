/**
 * @module cmdPlugins
 * @description Plugin registry for the GCS plugin host.
 *
 * Three tables back this module: `cmd_pluginInstalls`,
 * `cmd_pluginPermissions`, `cmd_pluginEvents`. Every row is scoped to
 * the authenticated user. The Settings -> Plugins page reads these
 * for its list, detail, permissions, and events tabs; the install
 * dialog writes them on operator approval.
 *
 * Capability gates run on the GCS bridge in `src/lib/plugins/bridge.ts`.
 * This module only persists state. Plugin code never sees these
 * functions; they are operator-facing.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  sourceValidator,
  statusValidator,
  halfValidator,
  eventTypeValidator,
  severityValidator,
  gcsParametersValidator,
  flightSkillsValidator,
  targetActionsValidator,
} from "./cmdPluginsValidators";

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

/** List every plugin install for the authenticated user. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("cmd_pluginInstalls")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Installs bound to one drone, scoped to the authenticated user. Each row is
 * returned raw (so its denormalized `flightSkills` / `targetActions` ride
 * along) plus a derived `grantedCapabilities` array — the granted permission
 * ids — so the cockpit Skill Bar hook can gate a plugin skill on
 * `ui.slot.flight-skill` exactly as the local-first path does.
 */
export const listForDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("cmd_pluginInstalls")
      .withIndex("by_drone", (q) => q.eq("droneId", deviceId))
      .collect();
    const mine = rows.filter((r) => r.userId === userId);
    const out = [];
    for (const install of mine) {
      const perms = await ctx.db
        .query("cmd_pluginPermissions")
        .withIndex("by_install", (q) => q.eq("pluginInstallId", install._id))
        .collect();
      const grantedCapabilities = perms
        .filter((p) => p.granted)
        .map((p) => p.permissionId);
      out.push({ ...install, grantedCapabilities });
    }
    return out;
  },
});

/** One install by id, scoped to the authenticated user. */
export const getInstall = query({
  args: { id: v.id("cmd_pluginInstalls") },
  handler: async (
    ctx,
    { id },
  ): Promise<Doc<"cmd_pluginInstalls"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) return null;
    return row;
  },
});

/** Permission rows for one install. Empty if caller is not the owner. */
export const listPermissionsForInstall = query({
  args: { installId: v.id("cmd_pluginInstalls") },
  handler: async (
    ctx,
    { installId },
  ): Promise<Doc<"cmd_pluginPermissions">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) return [];
    return await ctx.db
      .query("cmd_pluginPermissions")
      .withIndex("by_install", (q) => q.eq("pluginInstallId", installId))
      .collect();
  },
});

/** Fetch one install with its permission rows in a single round trip. */
export const getInstallWithPermissions = query({
  args: { installId: v.id("cmd_pluginInstalls") },
  handler: async (ctx, { installId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) return null;
    const permissions = await ctx.db
      .query("cmd_pluginPermissions")
      .withIndex("by_install", (q) => q.eq("pluginInstallId", installId))
      .collect();
    return { install, permissions };
  },
});

/**
 * Short-lived signed URL for a plugin's GCS bundle blob, owner-gated. The
 * contribution producer fetches this, turns it into a blob URL, and mounts
 * the iframe at a null origin. Null when the install has no GCS bundle or
 * the caller is not the owner.
 */
export const getBundleUrl = query({
  args: { installId: v.id("cmd_pluginInstalls") },
  handler: async (ctx, { installId }): Promise<string | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) return null;
    if (!install.bundleStorageId) return null;
    return await ctx.storage.getUrl(install.bundleStorageId);
  },
});

/**
 * Installs joined with their granted capability ids, denormalized
 * gcs.contributes slots, and a signed bundle URL — the single round trip
 * the contribution producer needs to mount iframes. With `deviceId` set,
 * returns that drone's installs; omitted, returns the user's GCS-only
 * (fleet-wide) installs. Only enabled/running installs that ship a GCS
 * half are returned.
 */
export const listForDeviceWithDetail = query({
  args: { deviceId: v.optional(v.string()) },
  handler: async (ctx, { deviceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const all = deviceId
      ? await ctx.db
          .query("cmd_pluginInstalls")
          .withIndex("by_drone", (q) => q.eq("droneId", deviceId))
          .collect()
      : await ctx.db
          .query("cmd_pluginInstalls")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
    const rows = all.filter((r) =>
      deviceId ? r.userId === userId : r.userId === userId && !r.droneId,
    );
    const out = [];
    for (const install of rows) {
      if (install.status !== "enabled" && install.status !== "running") {
        continue;
      }
      if (!install.halves.includes("gcs")) continue;
      const perms = await ctx.db
        .query("cmd_pluginPermissions")
        .withIndex("by_install", (q) => q.eq("pluginInstallId", install._id))
        .collect();
      const grantedCaps = perms
        .filter((p) => p.granted)
        .map((p) => p.permissionId);
      const bundleUrl = install.bundleStorageId
        ? await ctx.storage.getUrl(install.bundleStorageId)
        : null;
      out.push({
        installId: install._id,
        pluginId: install.pluginId,
        version: install.version,
        name: install.name,
        grantedCaps,
        gcsContributes: install.gcsContributes ?? [],
        gcsParameters: install.gcsParameters ?? [],
        bundleUrl,
      });
    }
    return out;
  },
});

/**
 * Recent crash events for the authenticated user, aggregated per install.
 * Used by the global crash banner to alert the operator that a plugin
 * died inside the configured rolling window (default 5 minutes). Returns
 * one entry per crashed install, newest-first by `lastAt`.
 */
export const recentCrashes = query({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const window = Math.max(args.sinceMs ?? 5 * 60 * 1000, 1);
    const since = Date.now() - window;
    // Walk the user-by-time index newest-first and stop once we cross
    // the window boundary. Cap at 500 events to keep the scan bounded
    // when an install is in a crash loop.
    const events = await ctx.db
      .query("cmd_pluginEvents")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", userId).gte("createdAt", since),
      )
      .order("desc")
      .take(500);
    type Aggregate = {
      installId: Id<"cmd_pluginInstalls">;
      pluginId: string;
      name: string;
      count: number;
      lastAt: number;
    };
    const byInstall = new Map<string, Aggregate>();
    for (const evt of events) {
      if (evt.severity !== "error" || evt.type !== "crashed") continue;
      const key = evt.pluginInstallId as unknown as string;
      const existing = byInstall.get(key);
      if (existing) {
        existing.count += 1;
        if (evt.createdAt > existing.lastAt) existing.lastAt = evt.createdAt;
        continue;
      }
      const install = await ctx.db.get(evt.pluginInstallId);
      if (!install || install.userId !== userId) continue;
      byInstall.set(key, {
        installId: evt.pluginInstallId,
        pluginId: evt.pluginId,
        name: install.name,
        count: 1,
        lastAt: evt.createdAt,
      });
    }
    return Array.from(byInstall.values()).sort((a, b) => b.lastAt - a.lastAt);
  },
});

/** Recent events for one install, newest-first, capped to 200. */
export const recentEvents = query({
  args: {
    installId: v.id("cmd_pluginInstalls"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { installId, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) return [];
    const cap = Math.min(Math.max(limit ?? 50, 1), 200);
    return await ctx.db
      .query("cmd_pluginEvents")
      .withIndex("by_install", (q) => q.eq("pluginInstallId", installId))
      .order("desc")
      .take(cap);
  },
});

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

/**
 * Record a fresh plugin install. The install dialog calls this AFTER
 * archive verification on the agent or GCS side. Permissions land as
 * `granted=false` rows; the operator approves them through
 * `grantPermission` before the plugin can do anything privileged.
 */
export const recordInstall = mutation({
  args: {
    droneId: v.optional(v.string()),
    pluginId: v.string(),
    version: v.string(),
    name: v.string(),
    source: sourceValidator,
    sourceUri: v.optional(v.string()),
    signerId: v.optional(v.string()),
    manifestHash: v.string(),
    halves: v.array(halfValidator),
    declaredPermissions: v.array(
      v.object({
        id: v.string(),
        required: v.boolean(),
      }),
    ),
    bundleStorageId: v.optional(v.id("_storage")),
    gcsContributes: v.optional(
      v.array(
        v.object({
          slot: v.string(),
          panelId: v.string(),
          title: v.optional(v.string()),
          icon: v.optional(v.string()),
          order: v.optional(v.number()),
          profile: v.optional(
            v.array(
              v.union(
                v.literal("drone"),
                v.literal("ground-station"),
                v.literal("workstation"),
              ),
            ),
          ),
        }),
      ),
    ),
    gcsParameters: v.optional(gcsParametersValidator),
    flightSkills: v.optional(flightSkillsValidator),
    targetActions: v.optional(targetActionsValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    if (args.halves.length === 0) {
      throw new Error("plugin must declare at least one half");
    }

    // Upsert: if the same user already installed this plugin id,
    // replace its install row and clear its prior permission grants.
    const existing = await ctx.db
      .query("cmd_pluginInstalls")
      .withIndex("by_user_plugin", (q) =>
        q.eq("userId", userId).eq("pluginId", args.pluginId),
      )
      .first();
    if (existing) {
      const oldPerms = await ctx.db
        .query("cmd_pluginPermissions")
        .withIndex("by_install", (q) => q.eq("pluginInstallId", existing._id))
        .collect();
      for (const p of oldPerms) await ctx.db.delete(p._id);
      await ctx.db.delete(existing._id);
    }

    const installedAt = Date.now();
    const installId: Id<"cmd_pluginInstalls"> = await ctx.db.insert(
      "cmd_pluginInstalls",
      {
        userId,
        droneId: args.droneId,
        pluginId: args.pluginId,
        version: args.version,
        name: args.name,
        source: args.source,
        sourceUri: args.sourceUri,
        signerId: args.signerId,
        manifestHash: args.manifestHash,
        status: "installed" as const,
        bundleStorageId: args.bundleStorageId,
        gcsContributes: args.gcsContributes,
        gcsParameters: args.gcsParameters,
        flightSkills: args.flightSkills,
        targetActions: args.targetActions,
        halves: args.halves,
        installedAt,
      },
    );

    for (const perm of args.declaredPermissions) {
      await ctx.db.insert("cmd_pluginPermissions", {
        userId,
        pluginInstallId: installId,
        pluginId: args.pluginId,
        permissionId: perm.id,
        granted: false,
        required: perm.required,
      });
    }

    await ctx.db.insert("cmd_pluginEvents", {
      userId,
      pluginInstallId: installId,
      pluginId: args.pluginId,
      type: "installed" as const,
      severity: "info" as const,
      message: `Installed ${args.pluginId} v${args.version}`,
      payload: {
        signerId: args.signerId,
        source: args.source,
      },
      createdAt: installedAt,
    });

    return installId;
  },
});

/**
 * Approve one declared permission. Throws if the permission was not
 * declared in the manifest at install time, defending against a
 * tampered client that tries to widen scope.
 */
export const grantPermission = mutation({
  args: {
    installId: v.id("cmd_pluginInstalls"),
    permissionId: v.string(),
  },
  handler: async (ctx, { installId, permissionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) {
      throw new Error("install not found");
    }
    const row = await ctx.db
      .query("cmd_pluginPermissions")
      .withIndex("by_install_perm", (q) =>
        q.eq("pluginInstallId", installId).eq("permissionId", permissionId),
      )
      .first();
    if (!row) {
      throw new Error(
        `permission ${permissionId} was not declared in the manifest`,
      );
    }
    if (row.granted) return row._id;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      granted: true,
      grantedAt: now,
      grantedBy: userId,
      revokedAt: undefined,
    });
    await ctx.db.insert("cmd_pluginEvents", {
      userId,
      pluginInstallId: installId,
      pluginId: install.pluginId,
      type: "permission_granted" as const,
      severity: "info" as const,
      message: `Granted ${permissionId}`,
      createdAt: now,
    });
    return row._id;
  },
});

/** Revoke one previously-granted permission. Required permissions
 * declared in the manifest cannot be revoked piecemeal — the operator
 * has to remove the plugin instead. This preserves the manifest
 * contract: a plugin that declared a perm as required can rely on it
 * being present whenever the install row exists. */
export const revokePermission = mutation({
  args: {
    installId: v.id("cmd_pluginInstalls"),
    permissionId: v.string(),
  },
  handler: async (ctx, { installId, permissionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) {
      throw new Error("install not found");
    }
    const row = await ctx.db
      .query("cmd_pluginPermissions")
      .withIndex("by_install_perm", (q) =>
        q.eq("pluginInstallId", installId).eq("permissionId", permissionId),
      )
      .first();
    if (!row || !row.granted) return;
    if (row.required) {
      throw new Error(
        `permission ${permissionId} is required by the manifest; remove the plugin instead`,
      );
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      granted: false,
      revokedAt: now,
    });
    await ctx.db.insert("cmd_pluginEvents", {
      userId,
      pluginInstallId: installId,
      pluginId: install.pluginId,
      type: "permission_revoked" as const,
      severity: "warning" as const,
      message: `Revoked ${permissionId}`,
      createdAt: now,
    });
  },
});

/** Update the install's lifecycle status (enabled/running/disabled/crashed). */
export const setStatus = mutation({
  args: {
    installId: v.id("cmd_pluginInstalls"),
    status: statusValidator,
  },
  handler: async (ctx, { installId, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) {
      throw new Error("install not found");
    }
    const patch: Partial<Doc<"cmd_pluginInstalls">> = { status };
    if (status === "enabled" || status === "running") {
      patch.enabledAt = Date.now();
    }
    await ctx.db.patch(installId, patch);
    await logLifecycleEvent(ctx, install, status);
  },
});

/** Hard delete: remove the install, its permission rows, and its event log. */
export const removeInstall = mutation({
  args: { installId: v.id("cmd_pluginInstalls") },
  handler: async (ctx, { installId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) {
      throw new Error("install not found");
    }
    const perms = await ctx.db
      .query("cmd_pluginPermissions")
      .withIndex("by_install", (q) => q.eq("pluginInstallId", installId))
      .collect();
    for (const p of perms) await ctx.db.delete(p._id);
    const events = await ctx.db
      .query("cmd_pluginEvents")
      .withIndex("by_install", (q) => q.eq("pluginInstallId", installId))
      .collect();
    for (const e of events) await ctx.db.delete(e._id);
    await ctx.db.delete(installId);
  },
});

/** Append an operator-supplied event row (notes, manual triage). */
export const recordEvent = mutation({
  args: {
    installId: v.id("cmd_pluginInstalls"),
    type: eventTypeValidator,
    severity: severityValidator,
    message: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { installId, type, severity, message, payload }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const install = await ctx.db.get(installId);
    if (!install || install.userId !== userId) {
      throw new Error("install not found");
    }
    return await ctx.db.insert("cmd_pluginEvents", {
      userId,
      pluginInstallId: installId,
      pluginId: install.pluginId,
      type,
      severity,
      message,
      payload,
      createdAt: Date.now(),
    });
  },
});

// ──────────────────────────────────────────────────────────────
// Retention sweep (cron-only)
// ──────────────────────────────────────────────────────────────

/** Plugin lifecycle events are kept for 30 days. */
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Bounded so a backlog cannot blow the per-call limits. */
const EVENT_PRUNE_BATCH = 256;

/**
 * Cron job: delete plugin events past the retention window.
 *
 * `cmd_pluginEvents` is append-only and written at machine cadence (every
 * install, enable, start, stop, crash and capability denial), and the table's
 * own schema comment promised this sweep while nothing swept it. Reads through
 * `by_createdAt` so the cost tracks what is deleted, not the table.
 */
export const pruneOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    const stale = await ctx.db
      .query("cmd_pluginEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(EVENT_PRUNE_BATCH);
    let deleted = 0;
    for (const row of stale) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
  },
});

// ──────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────

async function logLifecycleEvent(
  ctx: MutationCtx,
  install: Doc<"cmd_pluginInstalls">,
  status: Doc<"cmd_pluginInstalls">["status"],
): Promise<void> {
  const map: Partial<Record<typeof status, Doc<"cmd_pluginEvents">["type"]>> = {
    installed: "installed",
    enabled: "enabled",
    running: "started",
    disabled: "disabled",
    crashed: "crashed",
    removed: "removed",
  };
  const eventType = map[status];
  if (!eventType) return;
  await ctx.db.insert("cmd_pluginEvents", {
    userId: install.userId,
    pluginInstallId: install._id,
    pluginId: install.pluginId,
    type: eventType,
    severity: status === "crashed" ? "error" : "info",
    message: `Plugin ${install.pluginId} -> ${status}`,
    createdAt: Date.now(),
  });
}
