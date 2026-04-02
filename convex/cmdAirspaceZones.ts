import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Query airspace zones by jurisdiction.
 * Returns compact JSON blob for client-side rehydration.
 * Public query (no auth required) — airspace data is non-sensitive.
 */
export const getByJurisdiction = query({
  args: { jurisdiction: v.string() },
  handler: async (ctx, { jurisdiction }) => {
    const row = await ctx.db
      .query("cmd_airspaceZones")
      .withIndex("by_jurisdiction", (q) => q.eq("jurisdiction", jurisdiction))
      .first();

    if (!row) return null;

    return {
      jurisdiction: row.jurisdiction,
      zones: row.zones,
      zoneCount: row.zoneCount,
      generatedAt: row.generatedAt,
    };
  },
});
