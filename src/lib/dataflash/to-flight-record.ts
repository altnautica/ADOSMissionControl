/**
 * Convert a parsed ArduPilot DataFlash log into one or more FlightRecords.
 *
 * Splitting policy: walk EV (event) and ARM messages, slice the file into
 * runs between consecutive ARMED→DISARMED transitions, then build one
 * FlightRecord per run with synthetic TelemetryFrames so the existing
 * Charts / Replay / Analysis pipeline works unchanged.
 *
 * Input is a fully-parsed log from {@link parseDataflashLog}; output is an
 * array of records ready for `useHistoryStore.addRecord` plus the synthetic
 * frames written via `setRecordingFromFrames`.
 *
 * Pure function — no I/O. The caller persists frames to IDB.
 *
 * @module dataflash/to-flight-record
 * @license GPL-3.0-only
 */

import type { DataflashLog, DataflashRecord } from "./parser";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

/** ArduPilot EV (event) numbers we care about for arm/disarm splitting. */
const EV_ARMED = 10;
const EV_DISARMED = 11;
const EV_AUTO_ARMED = 15;

interface FlightSlice {
  /** ArduPilot TimeUS at the arm event. */
  startUs: number;
  /** ArduPilot TimeUS at the disarm event. */
  endUs: number;
}

interface BuiltFlight {
  record: FlightRecord;
  frames: TelemetryFrame[];
}

/** Convert raw ArduPilot µs ticks into ms relative to a reference. */
function usToOffsetMs(us: number, refUs: number): number {
  return Math.max(0, Math.round((us - refUs) / 1000));
}

/** Pull a number field from a DataflashRecord, returning undefined when absent. */
function num(r: DataflashRecord, key: string): number | undefined {
  const v = r[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Walk the log and detect every armed→disarmed pair. If the log only contains
 * ARM/DISARM events without `EV` rows, falls back to the ARMED state column
 * on the ARM message itself. If neither exists, treats the whole log as one
 * flight (best-effort).
 */
export function detectFlightSlices(log: DataflashLog): FlightSlice[] {
  const evRows = (log.messages.get("EV") ?? []) as DataflashRecord[];
  const armRows = (log.messages.get("ARM") ?? []) as DataflashRecord[];

  type StateChange = { us: number; armed: boolean };
  const changes: StateChange[] = [];

  for (const r of evRows) {
    const us = num(r, "TimeUS");
    const id = num(r, "Id");
    if (us === undefined || id === undefined) continue;
    if (id === EV_ARMED || id === EV_AUTO_ARMED) {
      changes.push({ us, armed: true });
    } else if (id === EV_DISARMED) {
      changes.push({ us, armed: false });
    }
  }

  // Fallback / supplement: ARM messages carry the explicit state.
  for (const r of armRows) {
    const us = num(r, "TimeUS");
    const armState = num(r, "ArmState");
    if (us === undefined || armState === undefined) continue;
    changes.push({ us, armed: armState === 1 });
  }

  changes.sort((a, b) => a.us - b.us);

  const slices: FlightSlice[] = [];
  let current: { startUs: number } | null = null;
  let lastArmed = false;
  for (const c of changes) {
    if (c.armed && !lastArmed) {
      current = { startUs: c.us };
      lastArmed = true;
    } else if (!c.armed && lastArmed) {
      if (current) {
        slices.push({ startUs: current.startUs, endUs: c.us });
        current = null;
      }
      lastArmed = false;
    }
  }

  // Best-effort fallback if no arm/disarm events at all: one flight covering
  // the full TimeUS range.
  if (slices.length === 0) {
    const allUs: number[] = [];
    for (const bucket of log.messages.values()) {
      for (const r of bucket) {
        const us = num(r, "TimeUS");
        if (us !== undefined) allUs.push(us);
      }
    }
    if (allUs.length >= 2) {
      slices.push({
        startUs: Math.min(...allUs),
        endUs: Math.max(...allUs),
      });
    }
  }

  return slices;
}

interface ConvertOptions {
  /** Identifier for the source drone — defaults to a parameter-derived hint. */
  droneId?: string;
  droneName?: string;
  /** Original filename for traceability (`my-flight.bin`). */
  sourceFilename?: string;
  /** Reference epoch (ms) for the absolute startTime. Defaults to `Date.now()` minus log span. */
  referenceEpochMs?: number;
}

/**
 * Convert a parsed dataflash log into FlightRecords + frame buckets.
 *
 * The caller is expected to persist the frames via
 * {@link setRecordingFromFrames} and then call `useHistoryStore.addRecord`
 * for each returned `record`. The `record.recordingId` already points at the
 * synthetic id we'll use.
 */
export function dataflashToFlightRecords(log: DataflashLog, options: ConvertOptions = {}): BuiltFlight[] {
  const slices = detectFlightSlices(log);
  if (slices.length === 0) return [];

  // Pick a wall-clock reference. We anchor each flight at "now - (totalSpan)"
  // so the imported list lands at the bottom of the History table by default.
  const firstStartUs = slices[0].startUs;
  const lastEndUs = slices[slices.length - 1].endUs;
  const totalSpanMs = Math.max(0, Math.round((lastEndUs - firstStartUs) / 1000));
  const refEpoch = options.referenceEpochMs ?? Date.now() - totalSpanMs;

  // Drone identification: prefer caller-supplied, otherwise derive from PARM
  // fields if present (SYSID_THISMAV / SYSID_MYGCS aren't ideal but the best
  // hint we have without a fleet binding).
  const sysid = log.params.get("SYSID_THISMAV");
  const droneId = options.droneId ?? `dataflash-sysid-${sysid ?? "unknown"}`;
  const droneName =
    options.droneName ?? (options.sourceFilename ? `Imported · ${options.sourceFilename}` : "Imported drone");

  return slices.map((slice, idx) =>
    buildFlight(log, slice, idx, refEpoch, firstStartUs, droneId, droneName, options.sourceFilename),
  );
}

function buildFlight(
  log: DataflashLog,
  slice: FlightSlice,
  idx: number,
  refEpoch: number,
  firstStartUs: number,
  droneId: string,
  droneName: string,
  sourceFilename: string | undefined,
): BuiltFlight {
  // Spread imported flights along the wall clock by each slice's relative offset
  // from the first armed event in the file.
  const safeStartMs = refEpoch + Math.round((slice.startUs - firstStartUs) / 1000);
  const durationSec = Math.max(0, Math.round((slice.endUs - slice.startUs) / 1_000_000));
  const endMs = safeStartMs + durationSec * 1000;

  // Walk every message bucket once and build telemetry frames + stats.
  const frames: TelemetryFrame[] = [];
  const path: [number, number][] = [];
  const PATH_INTERVAL_MS = 1000;
  const PATH_MAX = 1000;

  let prevLat: number | undefined;
  let prevLon: number | undefined;
  let distanceM = 0;
  let maxAltM = 0;
  let maxSpeedMs = 0;
  let speedSum = 0;
  let speedCount = 0;
  let battStartV: number | undefined;
  let battEndV: number | undefined;
  let lastPosOffset = -Infinity;
  let lastBattRem: number | undefined;

  // Channel mapping: dataflash message name → recorder channel name.
  const ATT_ROWS = (log.messages.get("ATT") ?? []) as DataflashRecord[];
  const POS_ROWS = (log.messages.get("POS") ?? []) as DataflashRecord[];
  const GPS_ROWS = (log.messages.get("GPS") ?? []) as DataflashRecord[];
  const BAT_ROWS = (log.messages.get("BAT") ?? log.messages.get("BAT2") ?? []) as DataflashRecord[];
  const VIBE_ROWS = (log.messages.get("VIBE") ?? []) as DataflashRecord[];
  const RCIN_ROWS = (log.messages.get("RCIN") ?? []) as DataflashRecord[];
  const RCOU_ROWS = (log.messages.get("RCOU") ?? []) as DataflashRecord[];
  const MODE_ROWS = (log.messages.get("MODE") ?? []) as DataflashRecord[];

  const inSlice = (us: number | undefined): boolean =>
    us !== undefined && us >= slice.startUs && us <= slice.endUs;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Attitude — convert deg to rad to match the live `attitude` channel shape.
  for (const r of ATT_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const roll = num(r, "Roll") ?? 0;
    const pitch = num(r, "Pitch") ?? 0;
    const yaw = num(r, "Yaw") ?? 0;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "attitude",
      data: {
        roll: toRad(roll),
        pitch: toRad(pitch),
        yaw: toRad(yaw),
        timestamp: us,
      },
    });
  }

  // POS — primary position source (lat/lon/alt in proper units).
  for (const r of POS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const lat = num(r, "Lat");
    const lon = num(r, "Lng");
    const alt = num(r, "Alt") ?? 0;
    if (lat === undefined || lon === undefined) continue;

    if (prevLat !== undefined && prevLon !== undefined) {
      distanceM += haversineMeters(prevLat, prevLon, lat, lon);
    }
    prevLat = lat;
    prevLon = lon;
    if (alt > maxAltM) maxAltM = alt;

    const offsetMs = usToOffsetMs(us!, slice.startUs);
    frames.push({
      offsetMs,
      channel: "position",
      data: {
        lat,
        lon,
        alt,
        relativeAlt: alt,
        groundSpeed: 0,
        airSpeed: 0,
        heading: 0,
        timestamp: us,
      },
    });

    if (offsetMs - lastPosOffset >= PATH_INTERVAL_MS && path.length < PATH_MAX) {
      path.push([lat, lon]);
      lastPosOffset = offsetMs;
    }
  }

  // GPS — speed + sat count + HDOP.
  for (const r of GPS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const sats = num(r, "NSats") ?? 0;
    const hdop = num(r, "HDop") ?? 0;
    const spd = num(r, "Spd") ?? 0;
    const fix = num(r, "Status") ?? 0;
    if (spd > maxSpeedMs) maxSpeedMs = spd;
    if (spd > 0) {
      speedSum += spd;
      speedCount += 1;
    }
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "gps",
      data: {
        satellites: sats,
        hdop,
        fixType: fix,
        lat: num(r, "Lat") ?? 0,
        lon: num(r, "Lng") ?? 0,
        alt: num(r, "Alt") ?? 0,
        timestamp: us,
      },
    });
  }

  // Battery — voltage / current / remaining %.
  for (const r of BAT_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const volt = num(r, "Volt") ?? num(r, "VoltR") ?? 0;
    const curr = num(r, "Curr") ?? 0;
    const rem = num(r, "RemPct") ?? num(r, "BatRem") ?? num(r, "Pct");
    if (battStartV === undefined && volt > 0) battStartV = volt;
    if (volt > 0) battEndV = volt;
    if (rem !== undefined) lastBattRem = rem;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "battery",
      data: {
        voltage: volt,
        current: curr,
        remaining: rem ?? -1,
        consumed: 0,
        timestamp: us,
      },
    });
  }

  // Vibration.
  for (const r of VIBE_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "vibration",
      data: {
        vibrationX: num(r, "VibeX") ?? 0,
        vibrationY: num(r, "VibeY") ?? 0,
        vibrationZ: num(r, "VibeZ") ?? 0,
        clipping0: num(r, "Clip0") ?? 0,
        clipping1: num(r, "Clip1") ?? 0,
        clipping2: num(r, "Clip2") ?? 0,
        timestamp: us,
      },
    });
  }

  // RC inputs.
  for (const r of RCIN_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const channels = [
      num(r, "C1") ?? 0,
      num(r, "C2") ?? 0,
      num(r, "C3") ?? 0,
      num(r, "C4") ?? 0,
      num(r, "C5") ?? 0,
      num(r, "C6") ?? 0,
      num(r, "C7") ?? 0,
      num(r, "C8") ?? 0,
    ];
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "rc",
      data: { channels, rssi: 255, timestamp: us },
    });
  }

  // Servo outputs.
  for (const r of RCOU_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const out = [
      num(r, "C1") ?? 0,
      num(r, "C2") ?? 0,
      num(r, "C3") ?? 0,
      num(r, "C4") ?? 0,
      num(r, "C5") ?? 0,
      num(r, "C6") ?? 0,
      num(r, "C7") ?? 0,
      num(r, "C8") ?? 0,
    ];
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "servoOutput",
      data: { servo: out, timestamp: us },
    });
  }

  // Mode changes — emitted as events later via the analyzer; record as frames
  // for completeness.
  for (const r of MODE_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "mode",
      data: { mode: num(r, "Mode") ?? 0, reason: num(r, "Rsn") ?? 0, timestamp: us },
    });
  }

  // Sort by offset to ensure monotonic playback.
  frames.sort((a, b) => a.offsetMs - b.offsetMs);

  // Battery used %: prefer start/end voltage delta projected onto a Li chemistry
  // sag curve (not great), otherwise use the last RemPct.
  let batteryUsed = 0;
  if (lastBattRem !== undefined && lastBattRem >= 0) {
    batteryUsed = Math.max(0, Math.min(100, Math.round(100 - lastBattRem)));
  } else if (battStartV !== undefined && battEndV !== undefined && battStartV > battEndV) {
    batteryUsed = Math.max(0, Math.min(100, Math.round(((battStartV - battEndV) / battStartV) * 100)));
  }

  const recordingId = `dataflash-${droneId}-${idx}-${slice.startUs}`;
  const startName = sourceFilename ?? "imported";

  const record: FlightRecord = {
    id: `dataflash-${idx}-${slice.startUs}-${slice.endUs}`,
    droneId,
    droneName,
    date: safeStartMs,
    startTime: safeStartMs,
    endTime: endMs,
    duration: durationSec,
    distance: Math.round(distanceM),
    maxAlt: Math.round(maxAltM),
    maxSpeed: Math.round(maxSpeedMs * 10) / 10,
    avgSpeed: speedCount > 0 ? Math.round((speedSum / speedCount) * 10) / 10 : 0,
    batteryStartV: battStartV,
    batteryEndV: battEndV,
    batteryUsed,
    waypointCount: 0,
    status: "completed",
    path: path.length >= 2 ? path : undefined,
    takeoffLat: path[0]?.[0],
    takeoffLon: path[0]?.[1],
    landingLat: path[path.length - 1]?.[0],
    landingLon: path[path.length - 1]?.[1],
    recordingId,
    hasTelemetry: frames.length > 0,
    updatedAt: Date.now(),
    source: "dataflash",
    sourceFilename: startName,
  };

  return { record, frames };
}

// ── Geo helper (duplicated from flight-lifecycle for module isolation) ──

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
