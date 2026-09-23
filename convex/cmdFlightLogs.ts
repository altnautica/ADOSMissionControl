/**
 * @module cmdFlightLogs
 * @description Convex functions for the History tab cloud sync.
 *
 * Each row is keyed on the client-generated `clientId` so local + cloud
 * stay in lockstep across multi-device usage. Conflict resolution is
 * last-write-wins on `updatedAt` (server is authoritative). Sealed
 * records (sign-and-lock) are tamper-protected: only volatile fields can be
 * patched without first unsealing.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
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
  startTime: v.number(),
  startTimeUnknown: v.optional(v.boolean()),
  endTime: v.number(),
  duration: v.number(),
  distance: v.optional(v.number()),
  maxAlt: v.optional(v.number()),
  maxSpeed: v.optional(v.number()),
  avgSpeed: v.optional(v.number()),
  batteryUsed: v.optional(v.number()),
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
    v.union(v.literal("live"), v.literal("dataflash"), v.literal("imported"), v.literal("ulog"), v.literal("tlog")),
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
  missionId: v.optional(v.string()),
  missionName: v.optional(v.string()),
  missionWaypoints: v.optional(
    v.array(
      v.object({
        lat: v.number(),
        lon: v.number(),
        alt: v.number(),
      }),
    ),
  ),
  adherence: v.optional(
    v.object({
      totalWaypoints: v.number(),
      waypointsReached: v.number(),
      maxCrossTrackErrorM: v.number(),
      meanCrossTrackErrorM: v.number(),
      deviationSegments: v.optional(
        v.array(
          v.object({
            startIdx: v.number(),
            endIdx: v.number(),
            maxErrorM: v.number(),
          }),
        ),
      ),
    }),
  ),
  geofenceSnapshot: v.optional(
    v.object({
      enabled: v.boolean(),
      maxAltitude: v.optional(v.number()),
      minAltitude: v.optional(v.number()),
      zones: v.optional(
        v.array(
          v.object({
            id: v.string(),
            role: v.union(v.literal("inclusion"), v.literal("exclusion")),
            type: v.union(v.literal("polygon"), v.literal("circle")),
            polygonPoints: v.optional(v.array(v.array(v.number()))),
            circleCenter: v.optional(v.array(v.number())),
            circleRadius: v.optional(v.number()),
          }),
        ),
      ),
    }),
  ),
  geofenceBreaches: v.optional(
    v.array(
      v.object({
        startIdx: v.number(),
        endIdx: v.number(),
        type: v.union(
          v.literal("polygon_outside"),
          v.literal("polygon_inside"),
          v.literal("circle_outside"),
          v.literal("circle_inside"),
          v.literal("max_altitude"),
          v.literal("min_altitude"),
        ),
        zoneId: v.string(),
        maxBreachDistanceM: v.optional(v.number()),
        peakIdx: v.optional(v.number()),
      }),
    ),
  ),
  phases: v.optional(
    v.array(
      v.object({
        type: v.union(
          v.literal("pre_arm"),
          v.literal("takeoff"),
          v.literal("climb"),
          v.literal("cruise"),
          v.literal("hover"),
          v.literal("descent"),
          v.literal("land"),
          v.literal("post_disarm"),
        ),
        startMs: v.number(),
        endMs: v.number(),
        avgSpeed: v.optional(v.number()),
        maxAlt: v.optional(v.number()),
      }),
    ),
  ),
  windEstimate: v.optional(
    v.object({
      speedMs: v.number(),
      fromDirDeg: v.number(),
      sampleCount: v.number(),
      method: v.union(v.literal("vfr_diff"), v.literal("fc_estimate")),
    }),
  ),
  media: v.optional(
    v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        type: v.string(),
        size: v.number(),
        capturedAt: v.number(),
        lat: v.optional(v.number()),
        lon: v.optional(v.number()),
        alt: v.optional(v.number()),
        blobKey: v.string(),
      }),
    ),
  ),
  deleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  takeoffPlaceName: v.optional(v.string()),
  landingPlaceName: v.optional(v.string()),
  country: v.optional(v.string()),
  region: v.optional(v.string()),
  locality: v.optional(v.string()),
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
  // The signature fields: `sealTransition` governs how they may change.
  "pilotSignedAt",
  "pilotSignatureHash",
  // Soft-delete is a metadata operation that should not break the seal.
  "deleted",
  "deletedAt",
  // Linked media is evidence attached after the flight, not flight data.
  "media",
]);

/** Rebuild a value with every object's keys in sorted order, at any depth. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = sortKeysDeep(src[key]);
  return out;
}

/** SHA-256 over a record's sealed (non-volatile) record fields, server side. */
async function sealedContentDigest(row: Record<string, unknown>): Promise<string> {
  const sealed: Record<string, unknown> = {};
  for (const key of Object.keys(RECORD_VALIDATOR)) {
    if (VOLATILE_KEYS.has(key) || key === "clientId") continue;
    sealed[key] = row[key];
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(sortKeysDeep(sealed))),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Seal transitions for an upsert over an existing row. Returns the server-side
 * bookkeeping to write alongside the record, or throws.
 *
 *  - A sealed row accepts only volatile-field changes, and its signature can
 *    only be cleared (unsealed), never swapped for another.
 *  - Unsealing records the released signature and a server digest of the
 *    content it covered.
 *  - Re-applying that released signature is refused unless the content is
 *    still the content it covered, so unseal -> edit -> restore-old-hash
 *    cannot produce a record that reads sealed over altered data.
 */
async function sealTransition(
  existing: Record<string, unknown>,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const wasSealed = typeof existing.pilotSignatureHash === "string" && existing.pilotSignatureHash !== "";
  const nextHash = typeof record.pilotSignatureHash === "string" ? record.pilotSignatureHash : "";

  if (wasSealed) {
    for (const key of Object.keys(record)) {
      if (VOLATILE_KEYS.has(key) || key === "clientId") continue;
      // Compare via JSON to handle nested objects deterministically.
      if (JSON.stringify(record[key]) !== JSON.stringify(existing[key])) {
        throw new Error(`Cannot mutate '${key}' on a sealed record. Unseal first.`);
      }
    }
    if (nextHash === "") {
      console.log(`flight log ${String(existing.clientId)} unsealed`);
      // A patch leaves absent fields alone, so the unseal must clear the
      // signature explicitly.
      return {
        pilotSignatureHash: undefined,
        pilotSignedAt: undefined,
        unsealedHash: existing.pilotSignatureHash,
        unsealedContentDigest: await sealedContentDigest(existing),
        unsealedAt: Date.now(),
      };
    }
    if (nextHash !== existing.pilotSignatureHash) {
      throw new Error("A sealed record's signature cannot be replaced. Unseal first.");
    }
    return {};
  }

  if (nextHash !== "" && nextHash === existing.unsealedHash) {
    if ((await sealedContentDigest(record)) !== existing.unsealedContentDigest) {
      throw new Error("A released signature cannot seal content that changed since it was released.");
    }
  }
  return {};
}

async function requireUser(ctx: QueryCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

// ── Aggregate maintenance ────────────────────────────────────
//
// stats + getCount used to .collect() every flight-log row (each loading the
// full document with large path/events/media arrays) just to sum four
// numbers. We instead keep one denormalized per-user row and update it
// incrementally on every upsert/remove, mirroring the prior full-scan
// semantics: each persisted row contributes its duration/distance/battery
// regardless of the soft-delete flag (the scan summed those rows too), and a
// hard remove subtracts the contribution.

interface AggregateContribution {
  count: number;
  totalSeconds: number;
  totalMeters: number;
  batteryHours: number;
}

/**
 * One flight log's contribution to the per-user aggregate. Matches the
 * arithmetic the prior full-scan used in {@link stats}.
 */
function contributionOf(
  record: { duration?: number; distance?: number; batteryUsed?: number },
): AggregateContribution {
  const duration = record.duration ?? 0;
  const distance = record.distance ?? 0;
  const batteryUsed = record.batteryUsed ?? 0;
  return {
    count: 1,
    totalSeconds: duration,
    totalMeters: distance,
    // Crude proxy: battery % used × duration ÷ 100. Mirrors the prior scan.
    batteryHours: (batteryUsed / 100) * (duration / 3600),
  };
}

/**
 * Apply a signed delta (an inserted/removed contribution, or the difference
 * between an old and new revision) to the user's aggregate row, creating it
 * on first write. Values are clamped at zero so floating-point drift across
 * many add/subtract cycles can never push a total negative.
 */
async function applyAggregateDelta(
  ctx: MutationCtx,
  userId: string,
  delta: AggregateContribution,
): Promise<void> {
  const existing = await ctx.db
    .query("cmd_flightLogAggregates")
    .withIndex("by_userId", (qb) => qb.eq("userId", userId))
    .unique();
  const now = Date.now();
  if (!existing) {
    // No aggregate row yet for a user who may already have flight history.
    // The row that triggered this delta is already written to cmd_flightLogs,
    // so seed the aggregate from a bounded scan of the user's current rows
    // (not from this single delta) — otherwise the user's entire prior history
    // would be dropped from stats/getCount the moment the first new flight
    // lands. Steady state patches the row below and never rescans.
    const seed = await scanAggregateFallback(ctx, userId);
    await ctx.db.insert("cmd_flightLogAggregates", {
      userId,
      count: Math.max(0, seed.count),
      totalSeconds: Math.max(0, seed.totalSeconds),
      totalMeters: Math.max(0, seed.totalMeters),
      batteryHours: Math.max(0, seed.batteryHours),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    count: Math.max(0, existing.count + delta.count),
    totalSeconds: Math.max(0, existing.totalSeconds + delta.totalSeconds),
    totalMeters: Math.max(0, existing.totalMeters + delta.totalMeters),
    batteryHours: Math.max(0, existing.batteryHours + delta.batteryHours),
    updatedAt: now,
  });
}

function subtractContribution(
  c: AggregateContribution,
): AggregateContribution {
  return {
    count: -c.count,
    totalSeconds: -c.totalSeconds,
    totalMeters: -c.totalMeters,
    batteryHours: -c.batteryHours,
  };
}

// Transitional fallback bound. Existing users have flight logs but no
// aggregate row yet (it is built incrementally on the next upsert/remove);
// until then stats/getCount fall back to a bounded scan so they do not read
// as zero. New activity populates the aggregate and the fast path takes over.
const AGGREGATE_FALLBACK_SCAN = 2000;

/**
 * Sum a bounded slice of a user's flight logs. Used only as the transitional
 * fallback when the denormalized aggregate row does not exist yet; the steady
 * state reads the single aggregate row and never reaches here.
 */
async function scanAggregateFallback(
  ctx: QueryCtx,
  userId: string,
): Promise<AggregateContribution> {
  const rows = await ctx.db
    .query("cmd_flightLogs")
    .withIndex("by_userId", (qb) => qb.eq("userId", userId))
    .take(AGGREGATE_FALLBACK_SCAN);
  const total: AggregateContribution = {
    count: 0,
    totalSeconds: 0,
    totalMeters: 0,
    batteryHours: 0,
  };
  for (const r of rows) {
    const c = contributionOf(r);
    total.count += c.count;
    total.totalSeconds += c.totalSeconds;
    total.totalMeters += c.totalMeters;
    total.batteryHours += c.batteryHours;
  }
  return total;
}

// ── Queries ──────────────────────────────────────────────────

/**
 * The signed-in user's flight logs, newest-first by `startTime`, one page at
 * a time, for the History tab and cloud-sync bridge.
 *
 * Optional `since` cutoff filters to rows whose `updatedAt` is strictly
 * greater than the cutoff. The
 * filter runs after pagination on the page array, so callers using
 * `since` should expect short or empty pages until the cursor reaches
 * older rows. For incremental sync the recommended pattern is to walk
 * with no `since` and stop early when the local store has already seen
 * a row.
 */
export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        page: [] as Array<never>,
        isDone: true,
        continueCursor: "",
      };
    }
    const result = await ctx.db
      .query("cmd_flightLogs")
      .withIndex("by_user_startTime", (qb) => qb.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    if (args.since !== undefined) {
      const cutoff = args.since;
      return {
        ...result,
        page: result.page.filter((r) => r.updatedAt > cutoff),
      };
    }
    return result;
  },
});

/**
 * Total flight-log count for the current user. Separate from
 * {@link listPaginated} so the History tab can show "X of Y" without
 * defeating pagination. Reads the denormalized aggregate row instead of
 * scanning every flight log.
 */
export const getCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const aggregate = await ctx.db
      .query("cmd_flightLogAggregates")
      .withIndex("by_userId", (qb) => qb.eq("userId", userId))
      .unique();
    if (aggregate) return aggregate.count;
    const fallback = await scanAggregateFallback(ctx, userId);
    return fallback.count;
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
    // Read the denormalized aggregate instead of scanning + deserializing
    // every flight log (each row carries large path/events/media arrays).
    const aggregate = await ctx.db
      .query("cmd_flightLogAggregates")
      .withIndex("by_userId", (qb) => qb.eq("userId", userId))
      .unique();
    const totals = aggregate
      ? {
          count: aggregate.count,
          totalSeconds: aggregate.totalSeconds,
          totalMeters: aggregate.totalMeters,
          batteryHours: aggregate.batteryHours,
        }
      : await scanAggregateFallback(ctx, userId);
    return {
      totalFlights: totals.count,
      totalHours: totals.totalSeconds / 3600,
      totalKm: totals.totalMeters / 1000,
      batteryHours: totals.batteryHours,
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

      // Tamper protection and seal bookkeeping (see `sealTransition`).
      const sealState = await sealTransition(
        existing as unknown as Record<string, unknown>,
        record as Record<string, unknown>,
      );

      await ctx.db.patch(existing._id, { ...record, ...sealState });
      // Apply the difference between the old and new revision to the
      // per-user aggregate so stats/getCount stay correct without a scan.
      const oldContribution = contributionOf(existing);
      const newContribution = contributionOf(record);
      await applyAggregateDelta(ctx, userId, {
        count: newContribution.count - oldContribution.count,
        totalSeconds: newContribution.totalSeconds - oldContribution.totalSeconds,
        totalMeters: newContribution.totalMeters - oldContribution.totalMeters,
        batteryHours: newContribution.batteryHours - oldContribution.batteryHours,
      });
      return { status: "updated" as const, id: existing._id };
    }

    const id = await ctx.db.insert("cmd_flightLogs", { userId, ...record });
    // New row: add its contribution to the per-user aggregate.
    await applyAggregateDelta(ctx, userId, contributionOf(record));
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
    // Subtract the removed row's contribution from the per-user aggregate.
    await applyAggregateDelta(
      ctx,
      userId,
      subtractContribution(contributionOf(existing)),
    );
    return { status: "deleted" as const };
  },
});
