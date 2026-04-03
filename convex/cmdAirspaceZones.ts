/**
 * @module cmdAirspaceZones
 * @description Server-side airspace zone generation and caching.
 * Generates compact circle-based airspace zones for all jurisdictions
 * (DGCA, FAA, CASA, EASA, CAA_UK, CAAC, JCAB, TCCA, ICAO fallback)
 * and stores them in Convex for instant client-side loading.
 *
 * Zones are stored as JSON strings in a compact format (single-letter keys)
 * to minimize storage and transfer size. The client deserializes and expands
 * them into full AirspaceZone objects with circle geometry.
 *
 * Cron runs every 24 hours. Zones only change when the airport database
 * changes, so daily sync is more than sufficient.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { query, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAirports, type Airport } from "./airportData";

// ── Compact zone format ──────────────────────────────────────────────
// Stored as JSON string in the database. Client-side deserializes and
// expands into full AirspaceZone objects with circle geometry.

interface CompactZone {
  /** Unique zone ID */
  id: string;
  /** Zone name */
  n: string;
  /** Zone type (AirspaceZoneType) */
  t: string;
  /** Floor altitude in meters */
  fa: number;
  /** Ceiling altitude in meters */
  ca: number;
  /** Regulatory authority */
  a: string;
  /** Jurisdiction code */
  j?: string;
  /** Circle definition: center lat/lon and radius in meters */
  c?: { lat: number; lon: number; r: number };
  /** LAANC ceiling in meters (FAA only) */
  lc?: number;
  /** Metadata key-value pairs */
  m?: Record<string, string>;
}

// ── Public query ─────────────────────────────────────────────────────

export const getByJurisdiction = query({
  args: { jurisdiction: v.string() },
  handler: async (ctx, { jurisdiction }) => {
    const doc = await ctx.db
      .query("cmd_airspaceZones")
      .withIndex("by_jurisdiction", (q) => q.eq("jurisdiction", jurisdiction))
      .first();
    if (!doc) return null;
    return {
      zones: doc.zones,
      zoneCount: doc.zoneCount,
      generatedAt: doc.generatedAt,
    };
  },
});

export const getAllZones = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("cmd_airspaceZones").collect();
    return docs.map((d) => ({
      jurisdiction: d.jurisdiction,
      zones: d.zones,
      zoneCount: d.zoneCount,
      generatedAt: d.generatedAt,
    }));
  },
});

// ── Internal mutation (called by action) ─────────────────────────────

export const upsertZones = internalMutation({
  args: {
    jurisdiction: v.string(),
    zones: v.string(),
    zoneCount: v.number(),
    generatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cmd_airspaceZones")
      .withIndex("by_jurisdiction", (q) =>
        q.eq("jurisdiction", args.jurisdiction),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("cmd_airspaceZones", args);
    }
  },
});

// ── Zone generators per jurisdiction ─────────────────────────────────

function generateDgcaZones(airports: Airport[]): CompactZone[] {
  const indian = airports.filter((a) => a.country_code === "IN");
  return indian.flatMap((ap) => [
    {
      id: `dgca-${ap.icao.toLowerCase()}-red`,
      n: `${ap.name} Red Zone`,
      t: "dgcaRed",
      fa: 0,
      ca: 0,
      a: "DGCA",
      j: "dgca",
      c: { lat: ap.lat, lon: ap.lon, r: 5_000 },
      m: { icao: ap.icao, zone: "red", digitalSky: "no-fly" },
    },
    {
      id: `dgca-${ap.icao.toLowerCase()}-yellow`,
      n: `${ap.name} Yellow Zone`,
      t: "dgcaYellow",
      fa: 0,
      ca: 60,
      a: "DGCA",
      j: "dgca",
      c: { lat: ap.lat, lon: ap.lon, r: 25_000 },
      m: { icao: ap.icao, zone: "yellow", digitalSky: "permission-required" },
    },
    {
      id: `dgca-${ap.icao.toLowerCase()}-green`,
      n: `${ap.name} Green Zone`,
      t: "dgcaGreen",
      fa: 0,
      ca: 120,
      a: "DGCA",
      j: "dgca",
      c: { lat: ap.lat, lon: ap.lon, r: 45_000 },
      m: { icao: ap.icao, zone: "green", digitalSky: "self-authorization" },
    },
  ]);
}

function generateFaaZones(airports: Airport[]): CompactZone[] {
  const us = airports.filter((a) => a.country_code === "US");
  return us.flatMap((ap) => {
    if (ap.type === "large_airport") {
      return [
        {
          id: `faa-${ap.icao.toLowerCase()}-classb`,
          n: `${ap.name} Class B`,
          t: "classB",
          fa: 0,
          ca: 3048, // 10,000 ft
          a: "FAA",
          j: "faa",
          c: { lat: ap.lat, lon: ap.lon, r: 30 * 1852 }, // 30 NM
          lc: 122, // 400 ft LAANC ceiling
          m: { icao: ap.icao },
        },
      ];
    } else if (ap.type === "medium_airport") {
      return [
        {
          id: `faa-${ap.icao.toLowerCase()}-classd`,
          n: `${ap.name} Class D`,
          t: "classD",
          fa: 0,
          ca: 762, // 2,500 ft
          a: "FAA",
          j: "faa",
          c: { lat: ap.lat, lon: ap.lon, r: 5 * 1852 }, // 5 NM
          lc: 61, // 200 ft LAANC ceiling
          m: { icao: ap.icao },
        },
      ];
    }
    return [];
  });
}

function generateCasaZones(airports: Airport[]): CompactZone[] {
  const au = airports.filter((a) => a.country_code === "AU");
  return au.flatMap((ap) => [
    {
      id: `casa-${ap.icao.toLowerCase()}-restricted`,
      n: `${ap.name} Aerodrome Restricted`,
      t: "casaRestricted",
      fa: 0,
      ca: 120,
      a: "CASA",
      j: "casa",
      c: { lat: ap.lat, lon: ap.lon, r: 5_500 },
      m: { icao: ap.icao },
    },
    {
      id: `casa-${ap.icao.toLowerCase()}-caution`,
      n: `${ap.name} Caution Zone`,
      t: "casaCaution",
      fa: 0,
      ca: 120,
      a: "CASA",
      j: "casa",
      c: { lat: ap.lat, lon: ap.lon, r: 10_000 },
      m: { icao: ap.icao },
    },
  ]);
}

// ── ICAO jurisdiction mapping ────────────────────────────────────────
// Mirrors src/lib/airspace/icao-zones.ts COUNTRY_TO_JURISDICTION

const COUNTRY_TO_JURISDICTION: Record<string, string> = {
  // EASA members (EU + EEA + Switzerland)
  DE: "easa", FR: "easa", ES: "easa", IT: "easa", NL: "easa", BE: "easa",
  PT: "easa", AT: "easa", SE: "easa", FI: "easa", NO: "easa", DK: "easa",
  PL: "easa", CZ: "easa", HU: "easa", RO: "easa", BG: "easa", HR: "easa",
  GR: "easa", IE: "easa", CH: "easa", LU: "easa", SK: "easa", SI: "easa",
  LT: "easa", LV: "easa", EE: "easa", CY: "easa", MT: "easa", IS: "easa",
  LI: "easa",
  // UK
  GB: "caa_uk",
  // China
  CN: "caac", HK: "caac", MO: "caac",
  // Japan
  JP: "jcab",
  // Canada
  CA: "tcca",
};

/** Countries handled by jurisdiction-specific generators (DGCA, FAA, CASA). */
const SPECIFIC_COUNTRIES = new Set(["IN", "US", "AU"]);

function generateIcaoForJurisdiction(
  airports: Airport[],
  jurisdiction: string,
): CompactZone[] {
  const filtered = airports.filter(
    (a) =>
      !SPECIFIC_COUNTRIES.has(a.country_code) &&
      COUNTRY_TO_JURISDICTION[a.country_code] === jurisdiction,
  );
  return filtered.flatMap((ap) => {
    if (ap.type === "large_airport") {
      return [
        {
          id: `${jurisdiction}-${ap.icao.toLowerCase()}-classb`,
          n: `${ap.name} Class B`,
          t: "classB",
          fa: 0,
          ca: 3048, // 10,000 ft
          a: jurisdiction.toUpperCase(),
          j: jurisdiction,
          c: { lat: ap.lat, lon: ap.lon, r: 15 * 1852 }, // 15 NM
          m: { icao: ap.icao },
        },
      ];
    } else if (ap.type === "medium_airport") {
      return [
        {
          id: `${jurisdiction}-${ap.icao.toLowerCase()}-classd`,
          n: `${ap.name} Class D`,
          t: "classD",
          fa: 0,
          ca: 762, // 2,500 ft
          a: jurisdiction.toUpperCase(),
          j: jurisdiction,
          c: { lat: ap.lat, lon: ap.lon, r: 5 * 1852 }, // 5 NM
          m: { icao: ap.icao },
        },
      ];
    }
    return [];
  });
}

/** Generate ICAO fallback zones for countries not in any specific jurisdiction. */
function generateIcaoFallbackZones(airports: Airport[]): CompactZone[] {
  const allMappedCountries = new Set([
    ...SPECIFIC_COUNTRIES,
    ...Object.keys(COUNTRY_TO_JURISDICTION),
  ]);
  const filtered = airports.filter(
    (a) => !allMappedCountries.has(a.country_code),
  );
  return filtered.flatMap((ap) => {
    if (ap.type === "large_airport") {
      return [
        {
          id: `icao-${ap.icao.toLowerCase()}-classb`,
          n: `${ap.name} Class B`,
          t: "classB",
          fa: 0,
          ca: 3048,
          a: "ICAO",
          j: "icao",
          c: { lat: ap.lat, lon: ap.lon, r: 15 * 1852 },
          m: { icao: ap.icao },
        },
      ];
    } else if (ap.type === "medium_airport") {
      return [
        {
          id: `icao-${ap.icao.toLowerCase()}-classd`,
          n: `${ap.name} Class D`,
          t: "classD",
          fa: 0,
          ca: 762,
          a: "ICAO",
          j: "icao",
          c: { lat: ap.lat, lon: ap.lon, r: 5 * 1852 },
          m: { icao: ap.icao },
        },
      ];
    }
    return [];
  });
}

// ── Sync action (called by cron) ─────────────────────────────────────

export const syncAllZones = internalAction({
  args: {},
  handler: async (ctx) => {
    const airports = await getAirports();
    const now = Date.now();

    const jurisdictions: { id: string; zones: CompactZone[] }[] = [
      { id: "dgca", zones: generateDgcaZones(airports) },
      { id: "faa", zones: generateFaaZones(airports) },
      { id: "casa", zones: generateCasaZones(airports) },
      { id: "easa", zones: generateIcaoForJurisdiction(airports, "easa") },
      { id: "caa_uk", zones: generateIcaoForJurisdiction(airports, "caa_uk") },
      { id: "caac", zones: generateIcaoForJurisdiction(airports, "caac") },
      { id: "jcab", zones: generateIcaoForJurisdiction(airports, "jcab") },
      { id: "tcca", zones: generateIcaoForJurisdiction(airports, "tcca") },
      { id: "icao", zones: generateIcaoFallbackZones(airports) },
    ];

    let totalZones = 0;
    for (const { id, zones } of jurisdictions) {
      await ctx.runMutation(internal.cmdAirspaceZones.upsertZones, {
        jurisdiction: id,
        zones: JSON.stringify(zones),
        zoneCount: zones.length,
        generatedAt: now,
      });
      totalZones += zones.length;
      console.log(`[airspace-sync] ${id}: ${zones.length} zones`);
    }
    console.log(
      `[airspace-sync] Complete: ${totalZones} zones across ${jurisdictions.length} jurisdictions`,
    );
  },
});
