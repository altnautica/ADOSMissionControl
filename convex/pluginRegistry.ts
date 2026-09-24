/**
 * Public-read mirror of the registry catalog. Self-hosted GCS instances
 * query this for plugin discovery. Catalog writes (submit, approve,
 * revoke) live in the website's Convex deployment only; this side
 * exposes the read surface used by the install dialog and the agent
 * auto-update poller.
 */

import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const listPlugins = query({
  args: {
    category: v.optional(
      v.union(
        v.literal("drivers"),
        v.literal("ui"),
        v.literal("ai"),
        v.literal("telemetry"),
        v.literal("tools"),
      ),
    ),
    license: v.optional(v.string()),
    signedOnly: v.optional(v.boolean()),
    verifiedOnly: v.optional(v.boolean()),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    let results;
    if (args.category) {
      const cat = args.category;
      results = await ctx.db
        .query("registry_plugins")
        .withIndex("by_category", (q) =>
          q.eq("category", cat).eq("status", "published"),
        )
        .collect();
    } else {
      const all = await ctx.db.query("registry_plugins").collect();
      results = all.filter((p) => p.status === "published");
    }

    if (args.license) {
      results = results.filter((p) => p.license === args.license);
    }
    if (args.verifiedOnly) {
      results = results.filter((p) => p.verified_publisher);
    }
    if (args.signedOnly === false) {
      // no-op; placeholder for self-hosted variants that allow unsigned.
    }
    if (args.query) {
      const q = args.query.toLowerCase();
      results = results.filter(
        (p) =>
          p.plugin_id.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      );
    }

    results.sort((a, b) => b.updated_at - a.updated_at);
    // The cursor is the offset of the next page in this sorted result, as
    // handed back in `nextCursor`.
    const offset = args.cursor === undefined ? 0 : Number(args.cursor);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("cursor must be a nextCursor value from a previous page");
    }
    const end = offset + limit;
    return {
      items: results.slice(offset, end),
      nextCursor: results.length > end ? String(end) : null,
      total: results.length,
    };
  },
});

export const getPlugin = query({
  args: { pluginId: v.string() },
  handler: async (ctx, args) => {
    const plugin = await ctx.db
      .query("registry_plugins")
      .withIndex("by_plugin_id", (q) => q.eq("plugin_id", args.pluginId))
      .first();
    if (!plugin) return null;
    if (plugin.status !== "published") return null;

    const recentVersions = await ctx.db
      .query("registry_versions")
      .withIndex("by_plugin_released", (q) =>
        q.eq("plugin_id", args.pluginId),
      )
      .order("desc")
      .take(20);

    return { plugin, versions: recentVersions };
  },
});

export const getVersion = query({
  args: {
    pluginId: v.string(),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("registry_versions")
      .withIndex("by_plugin_version", (q) =>
        q.eq("plugin_id", args.pluginId).eq("version", args.version),
      )
      .first();
  },
});

export const getDownloadUrl = query({
  args: {
    pluginId: v.string(),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    const versionRow = await ctx.db
      .query("registry_versions")
      .withIndex("by_plugin_version", (q) =>
        q.eq("plugin_id", args.pluginId).eq("version", args.version),
      )
      .first();
    if (!versionRow) return null;
    return { url: versionRow.download_url };
  },
});

export const getRevokedList = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("registry_revocations").collect();
    const signer_keys: string[] = [];
    const plugin_versions: string[] = [];
    for (const r of all) {
      if (r.kind === "signer_key") signer_keys.push(r.target);
      else if (r.kind === "plugin_version") plugin_versions.push(r.target);
    }
    return {
      signer_keys,
      plugin_versions,
      generated_at: Date.now(),
    };
  },
});

// ── Ops: set plugin status ─────────────────────────────────
//
// Internal mutation invoked via `npx convex run` with the admin
// deploy key. Mirrors the same function in the website's
// `convex/pluginRegistry.ts` per the dual-convex sync convention.
// Both apps share one Convex deployment; the function lives in both
// directories so the GCS deploy is self-consistent.
export const setPluginStatus = internalMutation({
  args: {
    pluginId: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("deprecated"),
      v.literal("removed"),
    ),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.db
      .query("registry_plugins")
      .withIndex("by_plugin_id", (q) => q.eq("plugin_id", args.pluginId))
      .first();
    if (!plugin) {
      throw new Error(`plugin ${args.pluginId} not found`);
    }
    await ctx.db.patch(plugin._id, {
      status: args.status,
      updated_at: Date.now(),
    });
    return {
      plugin_id: args.pluginId,
      previous_status: plugin.status,
      status: args.status,
    };
  },
});
