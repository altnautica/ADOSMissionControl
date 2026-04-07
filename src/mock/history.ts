/**
 * Demo mode flight history seeder.
 *
 * Produces a curated set of ~30 realistic flight records spread across the
 * last 30 days, plus synthetic telemetry recordings for ~12 of them so the
 * History detail tabs (Overview, Map, Charts, Events, Analysis, Notes,
 * Export) all have real content in demo mode.
 *
 * Bump {@link DEMO_SEED_VERSION} whenever the seeded dataset changes — the
 * History page uses it to clear stale demo records from IndexedDB on first
 * load after an update.
 *
 * @module mock/history
 * @license GPL-3.0-only
 */

import { get as idbGet, set as idbSet } from "idb-keyval";
import type { FlightRecord, SuiteType } from "@/lib/types";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";
import {
  SCENARIOS,
  DEMO_SITES,
  generatePath,
  pathDistanceM,
  generateEvents,
  generateFlags,
  generateHealth,
  generateTelemetryFrames,
  makePrng,
  randInt,
  pick,
  type Prng,
} from "./scenarios";

/**
 * Bump this whenever the seeder output changes. The History page resets
 * demo records in IndexedDB and re-seeds when the stored version differs.
 */
export const DEMO_SEED_VERSION = 2;

const DRONE_NAMES = ["Alpha-1", "Bravo-2", "Echo-5", "Charlie", "Delta"];
const DRONE_IDS = ["alpha-1", "bravo-2", "echo-5", "charlie", "delta"];

interface SeedPlanRow {
  suite: SuiteType;
  ageDays: number;
  status: "completed" | "aborted" | "emergency";
  hasTelemetry: boolean;
  favorite: boolean;
}

/**
 * Hand-tuned plan for the seed: ~30 flights with a deliberate mix of
 * suites, ages, statuses, telemetry coverage, and favorites.
 */
const SEED_PLAN: SeedPlanRow[] = [
  // Today (5 flights)
  { suite: "sentry", ageDays: 0.05, status: "completed", hasTelemetry: true, favorite: true },
  { suite: "survey", ageDays: 0.15, status: "completed", hasTelemetry: true, favorite: false },
  { suite: "agriculture", ageDays: 0.25, status: "completed", hasTelemetry: true, favorite: true },
  { suite: "inspection", ageDays: 0.4, status: "completed", hasTelemetry: true, favorite: false },
  { suite: "cargo", ageDays: 0.6, status: "completed", hasTelemetry: true, favorite: true },
  // Last 7 days (8 flights)
  { suite: "sentry", ageDays: 1.1, status: "completed", hasTelemetry: true, favorite: false },
  { suite: "sar", ageDays: 1.4, status: "completed", hasTelemetry: true, favorite: true },
  { suite: "survey", ageDays: 2.2, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "agriculture", ageDays: 2.8, status: "completed", hasTelemetry: true, favorite: false },
  { suite: "cargo", ageDays: 3.3, status: "aborted", hasTelemetry: true, favorite: false },
  { suite: "inspection", ageDays: 4.0, status: "completed", hasTelemetry: true, favorite: true },
  { suite: "sentry", ageDays: 5.5, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "sar", ageDays: 6.8, status: "completed", hasTelemetry: true, favorite: false },
  // 8–30 days ago (17 flights)
  { suite: "survey", ageDays: 8.2, status: "completed", hasTelemetry: false, favorite: true },
  { suite: "agriculture", ageDays: 9.5, status: "completed", hasTelemetry: true, favorite: false },
  { suite: "sentry", ageDays: 10.4, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "inspection", ageDays: 11.6, status: "completed", hasTelemetry: false, favorite: true },
  { suite: "cargo", ageDays: 12.9, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "survey", ageDays: 13.7, status: "completed", hasTelemetry: true, favorite: false },
  { suite: "sar", ageDays: 15.0, status: "emergency", hasTelemetry: true, favorite: true },
  { suite: "agriculture", ageDays: 16.4, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "sentry", ageDays: 17.8, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "inspection", ageDays: 19.1, status: "completed", hasTelemetry: false, favorite: true },
  { suite: "survey", ageDays: 20.5, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "cargo", ageDays: 22.0, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "sar", ageDays: 23.6, status: "aborted", hasTelemetry: false, favorite: false },
  { suite: "agriculture", ageDays: 25.2, status: "completed", hasTelemetry: false, favorite: true },
  { suite: "sentry", ageDays: 26.4, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "survey", ageDays: 27.8, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "inspection", ageDays: 28.9, status: "completed", hasTelemetry: false, favorite: false },
  { suite: "sar", ageDays: 29.7, status: "completed", hasTelemetry: false, favorite: false },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function randId(rand: Prng): string {
  return `demo-${rand().toString(36).substring(2, 10)}`;
}

function deriveDuration(scenario: { extentM: number; speedMs: number }, pattern: string, rand: Prng): number {
  const base: Record<string, number> = {
    orbit: 600,
    grid: 1500,
    expanding_box: 1200,
    spray_rows: 1700,
    waypoint_hop: 900,
    facade_orbit: 720,
  };
  return base[pattern] + randInt(rand, -120, 240);
}

function buildRecord(plan: SeedPlanRow, idx: number, rand: Prng, baseTime: number): FlightRecord {
  const scenario = SCENARIOS[plan.suite];
  const site = pick(rand, DEMO_SITES);
  const droneIdx = randInt(rand, 0, 3); // exclude Delta (maintenance)
  const startTime = baseTime - plan.ageDays * DAY_MS;
  const duration = deriveDuration(scenario, scenario.pattern, rand);
  const path = generatePath(
    scenario.pattern,
    site.lat + (rand() - 0.5) * 0.01,
    site.lon + (rand() - 0.5) * 0.01,
    scenario.extentM,
    rand,
  );
  const distance = Math.round(pathDistanceM(path));
  const maxAlt = scenario.altitudeM + randInt(rand, -8, 12);
  const maxSpeed = Math.round((scenario.speedMs * (1.05 + rand() * 0.2)) * 10) / 10;
  const avgSpeed = Math.round(scenario.speedMs * 10) / 10;
  const batteryUsed =
    plan.status === "emergency"
      ? randInt(rand, 78, 92)
      : plan.status === "aborted"
        ? randInt(rand, 35, 55)
        : randInt(rand, 38, 72);
  const batteryStartV = Math.round((25.1 + rand() * 0.2) * 100) / 100;
  const batteryEndV = Math.round((batteryStartV - (batteryUsed / 100) * 4.8) * 100) / 100;
  const waypointCount = Math.max(4, Math.min(20, Math.round(path.length / 12)));

  // Tags: 2-3 from the pool, deterministic by rand.
  const tagCount = 2 + Math.floor(rand() * 2);
  const tags: string[] = [];
  const pool = [...scenario.tagPool];
  for (let i = 0; i < tagCount && pool.length > 0; i++) {
    const j = Math.floor(rand() * pool.length);
    tags.push(pool.splice(j, 1)[0]);
  }

  const events = generateEvents(scenario, duration, waypointCount, plan.status, rand);
  const flags = generateFlags(plan.status, rand);
  const health = generateHealth(rand);

  const record: FlightRecord = {
    id: randId(rand),
    droneId: DRONE_IDS[droneIdx],
    droneName: DRONE_NAMES[droneIdx],
    suiteType: plan.suite,
    date: startTime,
    startTime,
    endTime: startTime + duration * 1000,
    duration,
    distance,
    maxAlt,
    maxSpeed,
    avgSpeed,
    batteryUsed,
    batteryStartV,
    batteryEndV,
    waypointCount,
    status: plan.status,
    path,
    takeoffLat: path[0][0],
    takeoffLon: path[0][1],
    landingLat: path[path.length - 1][0],
    landingLon: path[path.length - 1][1],
    hasTelemetry: plan.hasTelemetry,
    updatedAt: startTime + duration * 1000,
    favorite: plan.favorite,
    tags,
    customName: pick(rand, scenario.customNames),
    notes: `${pick(rand, scenario.notes)}\n\n_Site: ${site.name}._`,
    events,
    flags,
    health,
    pilotFirstName: "Demo",
    pilotLastName: "Pilot",
    pilotLicenseNumber: "RPC-DEMO-0042",
    pilotLicenseIssuer: "DGCA (demo)",
    aircraftRegistration: `VT-DEMO-${String(idx + 1).padStart(3, "0")}`,
    aircraftSerial: `SN-${1000 + idx}`,
    aircraftMtomKg: 1.6,
  };

  // Sign-and-lock the most recent 5 completed flights.
  if (idx < 5 && plan.status === "completed") {
    record.pilotSignedAt = record.endTime + 60_000;
    record.pilotSignatureHash = `demo${(rand() * 1e16).toString(16).slice(0, 32)}`;
  }

  return record;
}

let _cachedHistory: FlightRecord[] | null = null;

/**
 * Returns the seeded demo flight history. Idempotent — the same set of
 * records is returned across calls in the same browser session.
 */
export function seedDemoHistory(): FlightRecord[] {
  if (_cachedHistory) return _cachedHistory;
  const rand = makePrng(1337);
  const baseTime = Date.now();
  const records = SEED_PLAN.map((plan, idx) => buildRecord(plan, idx, rand, baseTime));
  // Newest first.
  records.sort((a, b) => b.startTime - a.startTime);
  _cachedHistory = records;
  return records;
}

/** @deprecated use {@link seedDemoHistory} */
export function getFlightHistory(): FlightRecord[] {
  return seedDemoHistory();
}

// ── Synthetic telemetry recordings ──────────────────────────

const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";

/**
 * Write synthetic telemetry recordings to IndexedDB for any seeded flights
 * flagged with `hasTelemetry: true`. Mutates each affected record in place
 * to set `recordingId`. Idempotent — checks the recordings index first.
 *
 * Returns a Map of flight id → recording id for the records that got
 * recordings attached this call.
 */
export async function seedDemoTelemetryRecordings(
  records: FlightRecord[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const existingIndex: TelemetryRecording[] =
    (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
  const existingDemoIds = new Set(
    existingIndex.filter((r) => r.id.startsWith("demo-rec-")).map((r) => r.id),
  );

  // Use a fresh PRNG so frame content is deterministic regardless of how
  // many times this is called.
  const rand = makePrng(7331);
  const newIndex: TelemetryRecording[] = existingIndex.filter(
    (r) => !r.id.startsWith("demo-rec-"),
  );

  for (const record of records) {
    if (!record.hasTelemetry) continue;
    const recordingId = `demo-rec-${record.id.replace(/^demo-/, "")}`;
    record.recordingId = recordingId;
    out.set(record.id, recordingId);

    if (existingDemoIds.has(recordingId)) {
      // Already on disk — re-add to index without rewriting frames.
      const existing = existingIndex.find((r) => r.id === recordingId);
      if (existing) newIndex.push(existing);
      continue;
    }

    const scenario = SCENARIOS[record.suiteType ?? "sentry"];
    const frames = generateTelemetryFrames(
      {
        durationS: record.duration,
        path: record.path ?? [],
        maxAltM: record.maxAlt,
        cruiseSpeedMs: scenario.speedMs,
        batteryStartV: record.batteryStartV ?? 25.2,
        batteryEndV: record.batteryEndV ?? 22.5,
      },
      rand,
    );
    const recording: TelemetryRecording = {
      id: recordingId,
      name: `${record.customName ?? record.droneName} — ${new Date(
        record.startTime,
      ).toLocaleString()}`,
      startTime: record.startTime,
      endTime: record.endTime,
      durationMs: record.duration * 1000,
      frameCount: frames.length,
      channels: Array.from(new Set(frames.map((f) => f.channel))),
      droneId: record.droneId,
      droneName: record.droneName,
    };
    await idbSet(`${IDB_RECORDINGS_PREFIX}${recordingId}`, frames);
    newIndex.push(recording);
  }

  await idbSet(IDB_RECORDINGS_INDEX, newIndex);
  return out;
}
