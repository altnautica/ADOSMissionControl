/**
 * Convert a parsed ULog file into FlightRecord(s) + TelemetryFrame arrays.
 *
 * Splits on vehicle_status arming_state transitions (2 = armed, 1 = standby).
 * Follows the same output shape as `dataflash/to-flight-record.ts`.
 *
 * @module ulog/to-flight-record
 * @license GPL-3.0-only
 */

import type { UlogFile } from "./parser";
import { TOPIC_TO_CHANNEL, normalizeTopicData } from "./topics";
import type { TelemetryFrame } from "../telemetry-recorder";
import type { FlightRecord } from "../types";
import { haversineDistance } from "@/lib/geo/distance";

export interface BuiltUlogFlight {
  record: FlightRecord;
  frames: TelemetryFrame[];
}

/**
 * Convert a parsed ULog into one or more FlightRecords, split on arm/disarm.
 */
export function ulogToFlightRecords(
  log: UlogFile,
  sourceFilename?: string,
): BuiltUlogFlight[] {
  // 1. Detect arm/disarm transitions from vehicle_status
  const statusRows = log.data.get("vehicle_status") ?? [];
  const armRanges = detectArmRanges(statusRows);

  // If no vehicle_status, treat entire log as one flight
  if (armRanges.length === 0) {
    const allFrames = buildAllFrames(log, 0, Infinity);
    if (allFrames.length === 0) return [];
    const record = buildRecordFromFrames(allFrames, 0, sourceFilename);
    return [{ record, frames: allFrames }];
  }

  // 2. Build a flight for each arm range
  const flights: BuiltUlogFlight[] = [];
  for (const { startUs, endUs } of armRanges) {
    const frames = buildAllFrames(log, startUs, endUs);
    if (frames.length < 2) continue;
    const record = buildRecordFromFrames(frames, startUs, sourceFilename);
    flights.push({ record, frames });
  }

  return flights;
}

// ── Arm range detection ──────────────────────────────────────

interface ArmRange {
  startUs: number;
  endUs: number;
}

function detectArmRanges(rows: Record<string, unknown>[]): ArmRange[] {
  const ranges: ArmRange[] = [];
  let armStart: number | null = null;

  for (const row of rows) {
    const ts = typeof row.timestamp === "number" ? row.timestamp : 0;
    const armingState = typeof row.arming_state === "number" ? row.arming_state : 0;

    if (armingState === 2 && armStart === null) {
      armStart = ts;
    } else if (armingState !== 2 && armStart !== null) {
      ranges.push({ startUs: armStart, endUs: ts });
      armStart = null;
    }
  }

  // Close open range at end of log
  if (armStart !== null && rows.length > 0) {
    const lastTs = typeof rows[rows.length - 1].timestamp === "number"
      ? (rows[rows.length - 1].timestamp as number)
      : armStart;
    ranges.push({ startUs: armStart, endUs: lastTs });
  }

  return ranges;
}

// ── Frame building ───────────────────────────────────────────

function buildAllFrames(
  log: UlogFile,
  startUs: number,
  endUs: number,
): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];

  for (const [topic, rows] of log.data.entries()) {
    const channel = TOPIC_TO_CHANNEL[topic];
    if (!channel) continue;

    for (const row of rows) {
      const ts = typeof row.timestamp === "number" ? row.timestamp : 0;
      if (ts < startUs || ts > endUs) continue;

      const offsetMs = (ts - startUs) / 1000; // µs → ms
      const data = normalizeTopicData(topic, row);
      frames.push({ offsetMs, channel, data });
    }
  }

  // Sort by time
  frames.sort((a, b) => a.offsetMs - b.offsetMs);
  addRelativeAltitude(frames, homeAltitudeAt(log, startUs));
  return frames;
}

/**
 * AMSL home altitude in effect at `startUs`: the latest home_position row at
 * or before it, else the first one logged. Undefined when the log has none.
 */
function homeAltitudeAt(log: UlogFile, startUs: number): number | undefined {
  let chosen: number | undefined;
  for (const row of log.data.get("home_position") ?? []) {
    const alt = typeof row.alt === "number" && isFinite(row.alt) ? row.alt : undefined;
    if (alt === undefined) continue;
    const ts = typeof row.timestamp === "number" ? row.timestamp : 0;
    if (chosen === undefined || ts <= startUs) chosen = alt;
    if (ts > startUs) break;
  }
  return chosen;
}

/**
 * Set `relativeAlt` (height above home) on every globalPosition frame from
 * its AMSL `alt`. Without a logged home, the first fix of the flight is the
 * reference, which is where the vehicle armed.
 */
function addRelativeAltitude(frames: TelemetryFrame[], homeAlt: number | undefined): void {
  let ref = homeAlt;
  for (const f of frames) {
    if (f.channel !== "globalPosition") continue;
    const d = f.data as Record<string, unknown>;
    if (typeof d.alt !== "number") continue;
    if (ref === undefined) ref = d.alt;
    d.relativeAlt = d.alt - ref;
  }
}

// ── Record building ──────────────────────────────────────────

function buildRecordFromFrames(
  frames: TelemetryFrame[],
  startUs: number,
  sourceFilename?: string,
): FlightRecord {
  const id = crypto.randomUUID();
  const startTime = Date.now(); // Approximate — ULog timestamps are relative
  const durationMs = frames[frames.length - 1].offsetMs - frames[0].offsetMs;
  const duration = Math.max(0, Math.round(durationMs / 1000));

  // Extract stats from position frames
  let maxAlt = 0;
  let maxSpeed = 0;
  let totalSpeed = 0;
  let speedCount = 0;
  let distance = 0;
  let prevLat: number | undefined;
  let prevLon: number | undefined;
  let firstLat: number | undefined;
  let firstLon: number | undefined;
  let lastLat: number | undefined;
  let lastLon: number | undefined;
  const path: [number, number][] = [];
  let pathSampleMs = -Infinity;

  // Battery
  let battStart: number | undefined;
  let battEnd: number | undefined;

  for (const f of frames) {
    const d = f.data as Record<string, unknown>;

    if (f.channel === "globalPosition") {
      const alt = typeof d.relativeAlt === "number" ? d.relativeAlt : undefined;
      const gs = typeof d.groundSpeed === "number" ? d.groundSpeed : undefined;
      const lat = typeof d.lat === "number" ? d.lat : undefined;
      const lon = typeof d.lon === "number" ? d.lon : undefined;

      if (alt !== undefined && alt > maxAlt) maxAlt = alt;
      if (gs !== undefined) {
        if (gs > maxSpeed) maxSpeed = gs;
        totalSpeed += gs;
        speedCount++;
      }
      if (lat !== undefined && lon !== undefined) {
        if (firstLat === undefined) { firstLat = lat; firstLon = lon; }
        if (prevLat !== undefined && prevLon !== undefined) {
          distance += haversineDistance(prevLat, prevLon, lat, lon);
        }
        prevLat = lat;
        prevLon = lon;
        lastLat = lat;
        lastLon = lon;

        // 1 Hz path downsample
        if (f.offsetMs - pathSampleMs >= 1000) {
          path.push([lat, lon]);
          pathSampleMs = f.offsetMs;
        }
      }
    }

    if (f.channel === "battery") {
      const v = typeof d.voltage === "number" ? d.voltage : undefined;
      if (v !== undefined) {
        if (battStart === undefined) battStart = v;
        battEnd = v;
      }
    }
  }

  const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 0;
  const batteryUsed = battStart !== undefined && battEnd !== undefined
    ? Math.max(0, Math.round(((battStart - battEnd) / battStart) * 100))
    : undefined;

  // Cap path
  const cappedPath = path.length > 1000
    ? path.filter((_, i) => i % Math.ceil(path.length / 1000) === 0)
    : path;

  return {
    id,
    droneId: `ulog-${startUs}`,
    droneName: sourceFilename?.replace(/\.ulg$/i, "") ?? "PX4 Import",
    date: startTime,
    startTime,
    endTime: startTime + duration * 1000,
    duration,
    distance,
    maxAlt,
    maxSpeed,
    avgSpeed,
    batteryUsed,
    batteryStartV: battStart,
    batteryEndV: battEnd,
    waypointCount: 0,
    status: "completed",
    path: cappedPath.length >= 2 ? cappedPath : undefined,
    takeoffLat: firstLat,
    takeoffLon: firstLon,
    landingLat: lastLat,
    landingLon: lastLon,
    recordingId: id,
    hasTelemetry: true,
    source: "ulog",
    sourceFilename,
    updatedAt: Date.now(),
  };
}
