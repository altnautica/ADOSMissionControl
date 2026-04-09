/**
 * @module cmdFlightLogs
 * @description Convex functions for the History tab cloud sync (Phase 9).
 *
 * Each row is keyed on the client-generated `clientId` so local + cloud
 * stay in lockstep across multi-device usage. Conflict resolution is
 * last-write-wins on `updatedAt` (server is authoritative). Sealed
 * records (Phase 7c-3) are tamper-protected: only volatile fields can be
 * patched without first unsealing.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ── Shared shapes ────────────────────────────────────────────

const EVENT_VALIDATOR = v.object({
  t: v.number(),
  type: v.string(),
  severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
  label: v.string(),
  data: v.optional(v.any()),
});

const FLAG_VALIDATOR = v.object({
  type: v.string(),
  severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
  message: v.string(),
  suggestion: v.optional(v.string()),
});

const HEALTH_VALIDATOR = v.object({
  avgSatellites: v.optional(v.number()),
  avgHdop: v.optional(v.number()),
  maxVibrationRms: v.optional(v.number()),
  batteryHealthPct: v.optional(v.number()),
});

const RECORD_VALIDATOR = {
  clientId: v.string(),
  droneId: v.string(),
  droneName: v.string(),
  suiteType: v.optional(v.string()),
  startTime: v.number(),
  endTime: v.number(),
  duration: v.number(),
  distance: v.number(),
  maxAlt: v.number(),
  maxSpeed: v.number(),
  avgSpeed: v.optional(v.number()),
  batteryUsed: v.number(),
  batteryStartV: v.optional(v.number()),
  batteryEndV: v.optional(v.number()),
  waypointCount: v.number(),
  status: v.union(
    v.literal("in_progress"),
    v.literal("completed"),
    v.literal("aborted"),
    v.literal("emergency"),
  ),
  takeoffLat: v.optional(v.number()),
  takeoffLon: v.optional(v.number()),
  landingLat: v.optional(v.number()),
  landingLon: v.optional(v.number()),
  path: v.optional(v.array(v.array(v.number()))),
  recordingId: v.optional(v.string()),
  hasTelemetry: v.optional(v.boolean()),
  events: v.optional(v.array(EVENT_VALIDATOR)),
  flags: v.optional(v.array(FLAG_VALIDATOR)),
  health: v.optional(HEALTH_VALIDATOR),
  customName: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  favorite: v.optional(v.boolean()),
  pilotFirstName: v.optional(v.string()),
  pilotLastName: v.optional(v.string()),
  pilotLicenseNumber: v.optional(v.string()),
  pilotLicenseIssuer: v.optional(v.string()),
  aircraftRegistration: v.optional(v.string()),
  aircraftSerial: v.optional(v.string()),
  aircraftMtomKg: v.optional(v.number()),
  pilotSignedAt: v.optional(v.number()),
  pilotSignatureHash: v.optional(v.string()),
  source: v.optional(
    v.union(v.literal("live"), v.literal("dataflash"), v.literal("imported")),
  ),
  sourceFilename: v.optional(v.string()),
  loadout: v.optional(
    v.object({
      batteryIds: v.optional(v.array(v.string())),
      propSetId: v.optional(v.string()),
      motorSetId: v.optional(v.string()),
      escSetId: v.optional(v.string()),
      cameraId: v.optional(v.string()),
      gimbalId: v.optional(v.string()),
      payloadId: v.optional(v.string()),
      frameId: v.optional(v.string()),
      rcTxId: v.optional(v.string()),
    }),
  ),
  sunMoon: v.optional(
    v.object({
      computedAt: v.string(),
      lat: v.number(),
      lon: v.number(),
      sunriseIso: v.optional(v.string()),
      sunsetIso: v.optional(v.string()),
      civilDawnIso: v.optional(v.string()),
      civilDuskIso: v.optional(v.string()),
      goldenHourMorningStartIso: v.optional(v.string()),
      goldenHourMorningEndIso: v.optional(v.string()),
      goldenHourEveningStartIso: v.optional(v.string()),
      goldenHourEveningEndIso: v.optional(v.string()),
      daylightPhase: v.union(
        v.literal("day"),
        v.literal("civil_twilight"),
        v.literal("nautical_twilight"),
        v.literal("astronomical_twilight"),
        v.literal("night"),
      ),
      inGoldenHour: v.boolean(),
      sunAltitudeDeg: v.number(),
      sunAzimuthDeg: v.number(),
      moonPhase: v.number(),
      moonIllumination: v.number(),
      moonPhaseLabel: v.string(),
      moonAltitudeDeg: v.number(),
      moonAzimuthDeg: v.number(),
    }),
  ),
  weatherSnapshot: v.optional(
    v.object({
      observedAt: v.string(),
      stationIcao: v.string(),
      stationName: v.optional(v.string()),
      stationLat: v.optional(v.number()),
      stationLon: v.optional(v.number()),
      stationDistanceKm: v.optional(v.number()),
      tempC: v.optional(v.number()),
      dewPointC: v.optional(v.number()),
      windDirDeg: v.optional(v.number()),
      windKts: v.optional(v.number()),
      gustKts: v.optional(v.number()),
      visibilityMi: v.optional(v.number()),
      ceilingFtAgl: v.optional(v.number()),
      altimeterHpa: v.optional(v.number()),
      flightCategory: v.optional(
        v.union(
          v.literal("VFR"),
          v.literal("MVFR"),
          v.literal("IFR"),
          v.literal("LIFR"),
        ),
      ),
      rawMetar: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  ),
  airspaceSnapshot: v.optional(
    v.object({
      computedAt: v.string(),
      pathSampleCount: v.number(),
      windowStartIso: v.string(),
      windowEndIso: v.string(),
      bbox: v.object({
        south: v.number(),
        north: v.number(),
        west: v.number(),
        east: v.number(),
      }),
      intersections: v.array(
        v.object({
          id: v.string(),
          kind: v.union(v.literal("zone"), v.literal("notam"), v.literal("tfr")),
          source: v.string(),
          type: v.string(),
          name: v.string(),
          severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
          floorAltitude: v.optional(v.number()),
          ceilingAltitude: v.optional(v.number()),
          effectiveStartIso: v.optional(v.string()),
          effectiveEndIso: v.optional(v.string()),
          summary: v.optional(v.string()),
        }),
      ),
    }),
  ),
  preflight: v.optional(
    v.object({
      checklistSessionId: v.optional(v.string()),
      checklistStartedAt: v.optional(v.number()),
      checklistComplete: v.optional(v.boolean()),
      checklistItems: v.optional(
        v.array(
          v.object({
            id: v.string(),
            category: v.string(),
            label: v.string(),
            status: v.union(
              v.literal("pending"),
              v.literal("pass"),
              v.literal("fail"),
              v.literal("skipped"),
            ),
            type: v.union(v.literal("auto"), v.literal("manual")),
            displayValue: v.optional(v.string()),
          }),
        ),
      ),
      sysStatusHealth: v.optional(v.number()),
      sysStatusPresent: v.optional(v.number()),
      sysStatusEnabled: v.optional(v.number()),
      prearmFailures: v.optional(v.array(v.string())),
    }),
  ),
  updatedAt: v.number(),
};

/**
 * Fields that may change on a sealed record without unsealing first.
 * Mirrors `compliance/sign.ts:VOLATILE_KEYS` on the client side.
 */
const VOLATILE_KEYS = new Set([
  "updatedAt",
  "events",
  "flags",
  "health",
  "notes",
  "tags",
  "favorite",
  "customName",
  // The signature itself can flip between sealed/unsealed.
  "pilotSignedAt",
  "pilotSignatureHash",
]);

async function requireUser(ctx: QueryCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

// ── Queries ──────────────────────────────────────────────────

export const list = query({
  args: { since: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    let q = ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_userId", (qb) => qb.eq("userId", userId));
    const rows = await q.collect();
    if (args.since !== undefined) {
      return rows.filter((r) => r.updatedAt > (args.since ?? 0));
    }
    return rows;
  },
});

export const get = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_clientId", (qb) =>
        qb.eq("userId", userId).eq("clientId", args.clientId),
      )
      .unique();
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { totalFlights: 0, totalHours: 0, totalKm: 0, batteryHours: 0 };
    }
    const rows = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_userId", (qb) => qb.eq("userId", userId))
      .collect();
    let totalSeconds = 0;
    let totalMeters = 0;
    let batteryHours = 0;
    for (const r of rows) {
      totalSeconds += r.duration ?? 0;
      totalMeters += r.distance ?? 0;
      // Crude proxy: battery % used × duration ÷ 100. Tightens up in Phase 12.
      batteryHours += ((r.batteryUsed ?? 0) / 100) * ((r.duration ?? 0) / 3600);
    }
    return {
      totalFlights: rows.length,
      totalHours: totalSeconds / 3600,
      totalKm: totalMeters / 1000,
      batteryHours,
    };
  },
});

// ── Mutations ────────────────────────────────────────────────

export const upsert = mutation({
  args: { record: v.object(RECORD_VALIDATOR) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { record } = args;

    const existing = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_clientId", (qb) =>
        qb.eq("userId", userId).eq("clientId", record.clientId),
      )
      .unique();

    if (existing) {
      // Last-write-wins: ignore patches that are not newer than the server row.
      if (record.updatedAt <= existing.updatedAt) {
        return { status: "stale" as const, id: existing._id };
      }

      // Tamper protection: a sealed row only accepts volatile-field patches.
      // If anything outside VOLATILE_KEYS differs, refuse the upsert.
      if (existing.pilotSignatureHash) {
        for (const key of Object.keys(record) as (keyof typeof record)[]) {
          if (VOLATILE_KEYS.has(key as string)) continue;
          if (key === "clientId") continue;
          // Compare via JSON to handle nested objects deterministically.
          if (
            JSON.stringify((record as Record<string, unknown>)[key]) !==
            JSON.stringify((existing as unknown as Record<string, unknown>)[key])
          ) {
            throw new Error(
              `Cannot mutate '${String(key)}' on a sealed record. Unseal first.`,
            );
          }
        }
      }

      await ctx.db.patch(existing._id, record);
      return { status: "updated" as const, id: existing._id };
    }

    const id = await ctx.db.insert("cmd_flightLogs", { userId, ...record });
    return { status: "inserted" as const, id };
  },
});

export const remove = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_clientId", (qb) =>
        qb.eq("userId", userId).eq("clientId", args.clientId),
      )
      .unique();
    if (!existing) return { status: "missing" as const };
    await ctx.db.delete(existing._id);
    return { status: "deleted" as const };
  },
});
