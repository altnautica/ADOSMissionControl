import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

interface NormalizedAircraft {
  icao24: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altitudeMsl: number | null;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
  category: number;
  lastSeen: number;
  originCountry: string;
  registration: string | null;
  aircraftType: string | null;
}

// ── Public queries ──────────────────────────────────────────────────

export const getByRegion = query({
  args: { region: v.string() },
  handler: async (ctx, { region }) => {
    const doc = await ctx.db
      .query("cmd_adsbCache")
      .withIndex("by_region", (q) => q.eq("region", region))
      .first();
    if (!doc) return null;
    return {
      region: doc.region,
      aircraft: JSON.parse(doc.aircraft) as NormalizedAircraft[],
      source: doc.source,
      fetchedAt: doc.fetchedAt,
      count: doc.count,
    };
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("cmd_adsbCache").collect();
    const seen = new Map<string, NormalizedAircraft>();
    let latestFetchedAt = 0;

    // Process adsb.lol regions first so they win dedup over opensky
    const adsbDocs = docs.filter((d) => !d.region.startsWith("opensky-"));
    const openskyDocs = docs.filter((d) => d.region.startsWith("opensky-"));

    for (const doc of adsbDocs) {
      const parsed = JSON.parse(doc.aircraft) as NormalizedAircraft[];
      for (const ac of parsed) {
        seen.set(ac.icao24, ac);
      }
      if (doc.fetchedAt > latestFetchedAt) latestFetchedAt = doc.fetchedAt;
    }

    for (const doc of openskyDocs) {
      const parsed = JSON.parse(doc.aircraft) as NormalizedAircraft[];
      for (const ac of parsed) {
        // Only add if not already seen from adsb.lol
        if (!seen.has(ac.icao24)) {
          seen.set(ac.icao24, ac);
        }
      }
      if (doc.fetchedAt > latestFetchedAt) latestFetchedAt = doc.fetchedAt;
    }

    const allAircraft = Array.from(seen.values());

    return {
      aircraft: allAircraft,
      source: "mixed" as const,
      fetchedAt: latestFetchedAt,
      count: allAircraft.length,
    };
  },
});

// ── Region list query ───────────────────────────────────────────────

export const getRegionList = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("cmd_adsbCache").collect();
    return docs.map((doc) => ({
      region: doc.region,
      count: doc.count,
      fetchedAt: doc.fetchedAt,
      source: doc.source,
    }));
  },
});

// ── Internal helpers for OpenSky cleanup ────────────────────────────

export const listOpenSkyRegions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("cmd_adsbCache").collect();
    return docs
      .filter((d) => d.region.startsWith("opensky-"))
      .map((d) => d.region);
  },
});

export const listAdsbRegions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("cmd_adsbCache").collect();
    return docs
      .filter((d) => !d.region.startsWith("opensky-"))
      .map((d) => d.region);
  },
});

// ── Batch mutations (reduces function calls by ~97%) ────────────────

export const batchUpsertRegions = internalMutation({
  args: {
    regions: v.array(
      v.object({
        region: v.string(),
        aircraft: v.string(),
        source: v.string(),
        fetchedAt: v.number(),
        count: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const r of args.regions) {
      const existing = await ctx.db
        .query("cmd_adsbCache")
        .withIndex("by_region", (q) => q.eq("region", r.region))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          aircraft: r.aircraft,
          source: r.source,
          fetchedAt: r.fetchedAt,
          count: r.count,
        });
      } else {
        await ctx.db.insert("cmd_adsbCache", {
          region: r.region,
          aircraft: r.aircraft,
          source: r.source,
          fetchedAt: r.fetchedAt,
          count: r.count,
        });
      }
    }
  },
});

export const batchDeleteRegions = internalMutation({
  args: {
    regions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    for (const region of args.regions) {
      const doc = await ctx.db
        .query("cmd_adsbCache")
        .withIndex("by_region", (q) => q.eq("region", region))
        .first();
      if (doc) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});
