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
import { haversineMeters } from "@/lib/flight-lifecycle/geo";
import { logClockOffsetMs } from "./gps-clock";

/** ArduPilot EV (event) numbers we care about for arm/disarm splitting. */
const EV_ARMED = 10;
const EV_DISARMED = 11;
const EV_AUTO_ARMED = 15;

/**
 * Every message this converter reads. Parsing only these (plus PARM, for the
 * parameter table) skips the high-rate IMU/EKF/PID rows a flight record never
 * uses.
 */
export const DATAFLASH_FLIGHT_MESSAGES: ReadonlySet<string> = new Set([
  "EV",
  "ARM",
  "ATT",
  "POS",
  "GPS",
  "BAT",
  "VIBE",
  "RCIN",
  "RCOU",
  "MODE",
  "PARM",
]);

interface FlightSlice {
  /** ArduPilot TimeUS at the arm event. */
  startUs: number;
  /** ArduPilot TimeUS at the disarm event, or the log's last TimeUS. */
  endUs: number;
  /** The log ended with the vehicle still armed: no disarm closed the flight. */
  endedArmed: boolean;
}

export interface BuiltFlight {
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
 * True for a row of the first sensor instance. Multi-instance messages (GPS
 * `I`, BAT `Inst`, VIBE `IMU`) log one row per instance; a row without the
 * instance column comes from a single-instance log.
 */
function isFirstInstance(r: DataflashRecord, key: string): boolean {
  return (num(r, key) ?? 0) === 0;
}

/**
 * Walk the log and detect every armed→disarmed pair. If the log only contains
 * ARM/DISARM events without `EV` rows, falls back to the ARMED state column
 * on the ARM message itself. A flight still armed when the log ends (brown-out,
 * battery ejection, crash) is closed at the log's last TimeUS rather than
 * dropped. If there are no arm events at all, treats the whole log as one
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

  // One pass for the log's TimeUS span. A .bin holds 10^5..10^6 records, so
  // spreading them into Math.min/Math.max overflows the call stack.
  let firstUs = Infinity;
  let lastUs = -Infinity;
  let stampedRows = 0;
  for (const bucket of log.messages.values()) {
    for (const r of bucket) {
      const us = num(r, "TimeUS");
      if (us === undefined) continue;
      if (us < firstUs) firstUs = us;
      if (us > lastUs) lastUs = us;
      stampedRows += 1;
    }
  }

  const slices: FlightSlice[] = [];
  let currentStartUs: number | null = null;
  for (const c of changes) {
    if (c.armed && currentStartUs === null) {
      currentStartUs = c.us;
    } else if (!c.armed && currentStartUs !== null) {
      slices.push({ startUs: currentStartUs, endUs: c.us, endedArmed: false });
      currentStartUs = null;
    }
  }
  if (currentStartUs !== null) {
    slices.push({ startUs: currentStartUs, endUs: Math.max(currentStartUs, lastUs), endedArmed: true });
  }

  if (slices.length === 0 && stampedRows >= 2) {
    slices.push({ startUs: firstUs, endUs: lastUs, endedArmed: false });
  }

  return slices;
}

export interface DataflashConvertOptions {
  /** Identifier for the source drone — defaults to a parameter-derived hint. */
  droneId?: string;
  droneName?: string;
  /** Original filename for traceability (`my-flight.bin`). */
  sourceFilename?: string;
}

/**
 * Convert a parsed dataflash log into FlightRecords + frame buckets.
 *
 * Flight times come from the log's GPS clock. A log without GPS time gets the
 * import time instead and is marked `startTimeUnknown`, so nothing presents
 * that time as when the flight happened.
 *
 * The caller is expected to persist the frames via
 * {@link setRecordingFromFrames} and then call `useHistoryStore.addRecord`
 * for each returned `record`. The `record.recordingId` already points at the
 * synthetic id we'll use.
 */
export function dataflashToFlightRecords(log: DataflashLog, options: DataflashConvertOptions = {}): BuiltFlight[] {
  const slices = detectFlightSlices(log);
  if (slices.length === 0) return [];

  const firstStartUs = slices[0].startUs;
  const clockOffsetMs = logClockOffsetMs(log);
  const startTimeUnknown = clockOffsetMs === undefined;
  // Without a GPS clock the flights are placed at "now minus the log span",
  // keeping their spacing, and flagged as having no known date.
  const lastEndUs = slices[slices.length - 1].endUs;
  const totalSpanMs = Math.max(0, Math.round((lastEndUs - firstStartUs) / 1000));
  const refEpoch =
    clockOffsetMs !== undefined
      ? Math.round(clockOffsetMs + firstStartUs / 1000)
      : Date.now() - totalSpanMs;

  // Drone identification: prefer caller-supplied, otherwise derive from PARM
  // fields if present (SYSID_THISMAV / SYSID_MYGCS aren't ideal but the best
  // hint we have without a fleet binding).
  const sysid = log.params.get("SYSID_THISMAV");
  const droneId = options.droneId ?? `dataflash-sysid-${sysid ?? "unknown"}`;
  const droneName =
    options.droneName ?? (options.sourceFilename ? `Imported · ${options.sourceFilename}` : "Imported drone");

  return slices.map((slice, idx) => {
    const built = buildFlight(log, slice, idx, refEpoch, firstStartUs, droneId, droneName, options.sourceFilename);
    if (startTimeUnknown) built.record.startTimeUnknown = true;
    return built;
  });
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
  const BAT_ROWS = (log.messages.get("BAT") ?? []) as DataflashRecord[];
  const VIBE_ROWS = (log.messages.get("VIBE") ?? []) as DataflashRecord[];
  const RCIN_ROWS = (log.messages.get("RCIN") ?? []) as DataflashRecord[];
  const RCOU_ROWS = (log.messages.get("RCOU") ?? []) as DataflashRecord[];
  const MODE_ROWS = (log.messages.get("MODE") ?? []) as DataflashRecord[];

  const inSlice = (us: number | undefined): boolean =>
    us !== undefined && us >= slice.startUs && us <= slice.endUs;

  // Attitude — ATT logs degrees, which is the recorded `attitude` contract
  // (live frames are AttitudeData in degrees), so the values pass through.
  for (const r of ATT_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "attitude",
      data: {
        roll: num(r, "Roll") ?? 0,
        pitch: num(r, "Pitch") ?? 0,
        yaw: num(r, "Yaw") ?? 0,
        timestamp: us,
      },
    });
  }

  // POS — primary position source. `Alt` is AMSL; the height above home is
  // `RelHomeAlt` on current firmware. Older logs lack it, so fall back to the
  // AMSL altitude minus the first fix of the flight (the arm point).
  let slicePosBaseAlt: number | undefined;
  for (const r of POS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us)) continue;
    const lat = num(r, "Lat");
    const lon = num(r, "Lng");
    const alt = num(r, "Alt");
    if (lat === undefined || lon === undefined || alt === undefined) continue;
    if (slicePosBaseAlt === undefined) slicePosBaseAlt = alt;
    const relativeAlt = num(r, "RelHomeAlt") ?? alt - slicePosBaseAlt;

    if (prevLat !== undefined && prevLon !== undefined) {
      distanceM += haversineMeters(prevLat, prevLon, lat, lon);
    }
    prevLat = lat;
    prevLon = lon;
    if (relativeAlt > maxAltM) maxAltM = relativeAlt;

    const offsetMs = usToOffsetMs(us!, slice.startUs);
    frames.push({
      offsetMs,
      channel: "position",
      data: {
        lat,
        lon,
        alt,
        relativeAlt,
        groundSpeed: 0,
        heading: 0,
        timestamp: us,
      },
    });

    if (offsetMs - lastPosOffset >= PATH_INTERVAL_MS && path.length < PATH_MAX) {
      path.push([lat, lon]);
      lastPosOffset = offsetMs;
    }
  }

  // GPS — speed + sat count + HDOP, from the first receiver only.
  for (const r of GPS_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "I")) continue;
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

  // Battery — voltage / current / remaining %, from the first monitor only.
  for (const r of BAT_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "Inst")) continue;
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

  // Vibration. Current firmware logs one VIBE row per IMU (`IMU`, `Clip`),
  // every IMU's row sharing the write's TimeUS; older logs carry all three
  // clip counters (`Clip0..2`) on one row. Levels come from the first IMU and
  // each IMU's clip count lands in its own slot; a count the log lacks stays
  // absent rather than reading as zero clipping.
  const clipsAt = new Map<number, Record<string, number>>();
  for (const r of VIBE_ROWS) {
    const us = num(r, "TimeUS");
    const imu = num(r, "IMU");
    const clip = num(r, "Clip");
    if (!inSlice(us) || imu === undefined || imu > 2 || clip === undefined) continue;
    const clips = clipsAt.get(us!) ?? {};
    clips[`clipping${imu}`] = clip;
    clipsAt.set(us!, clips);
  }
  for (const r of VIBE_ROWS) {
    const us = num(r, "TimeUS");
    if (!inSlice(us) || !isFirstInstance(r, "IMU")) continue;
    let clips: Record<string, number> = {};
    if (num(r, "IMU") !== undefined) {
      clips = clipsAt.get(us!) ?? {};
    } else {
      for (const i of [0, 1, 2]) {
        const clip = num(r, `Clip${i}`);
        if (clip !== undefined) clips[`clipping${i}`] = clip;
      }
    }
    frames.push({
      offsetMs: usToOffsetMs(us!, slice.startUs),
      channel: "vibration",
      data: {
        vibrationX: num(r, "VibeX") ?? 0,
        vibrationY: num(r, "VibeY") ?? 0,
        vibrationZ: num(r, "VibeZ") ?? 0,
        ...clips,
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
  let batteryUsed: number | undefined;
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
    // A log that stops while armed (brown-out, battery ejection, crash) did
    // not end in a normal disarm.
    status: slice.endedArmed ? "aborted" : "completed",
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
