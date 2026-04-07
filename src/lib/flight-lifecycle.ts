/**
 * Flight lifecycle — turn arm/disarm transitions into FlightRecord rows.
 *
 * The drone-manager bridge calls {@link notifyArmed} from inside its
 * heartbeat handler. We track per-drone armed state here (independent of
 * `drone-store`, which is single-drone) and on each transition we:
 *
 *  - disarmed → armed: start a recorder slot, create a draft FlightRecord
 *    with `status: "in_progress"`, persist it to IDB, store the draft id.
 *  - armed → disarmed: stop the recorder, walk frames once to compute
 *    stats (distance, max alt, max speed, battery delta, downsampled path),
 *    update the draft to `completed`, persist.
 *
 * Pure module — no React, no Zustand subscription. Importing it has no
 * side effects beyond defining the per-drone state map.
 *
 * @module flight-lifecycle
 * @license GPL-3.0-only
 */

import {
  startRecordingFor,
  stopRecordingFor,
  isRecordingFor,
  loadRecordingFrames,
  type TelemetryFrame,
} from "./telemetry-recorder";
import { useHistoryStore } from "@/stores/history-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { FlightRecord } from "./types";

// ── Per-drone lifecycle state ────────────────────────────────

interface DroneLifecycleState {
  armed: boolean;
  draftRecordId?: string;
  recordingId?: string;
}

export interface ArmSnapshot {
  /** Last-known position (lat, lon) for takeoff / landing coords. Optional. */
  lat?: number;
  lon?: number;
}

const _state = new Map<string, DroneLifecycleState>();

// ── Public API ───────────────────────────────────────────────

/**
 * Notify the lifecycle that {@link droneId}'s armed flag is currently {@link armed}.
 * Compares against the previous value and triggers an arm/disarm transition only
 * on change. Safe to call on every heartbeat.
 *
 * Call site: {@link bridgeTelemetry} inside `protocol.onHeartbeat`.
 */
export function notifyArmed(
  droneId: string,
  droneName: string,
  armed: boolean,
  snapshot: ArmSnapshot = {},
): void {
  const prev = _state.get(droneId)?.armed ?? false;
  if (prev === armed) return;

  if (armed) {
    handleArm(droneId, droneName, snapshot);
  } else {
    // Fire-and-forget — disarm finalization is async (loads frames from IDB).
    void handleDisarm(droneId);
  }
}

/** Test/teardown helper. Forgets a drone's lifecycle state. */
export function clearLifecycleState(droneId: string): void {
  _state.delete(droneId);
}

// ── Arm / disarm handlers ────────────────────────────────────

function handleArm(droneId: string, droneName: string, snapshot: ArmSnapshot): void {
  const startTime = Date.now();

  // Optionally start a recorder slot.
  const settings = useSettingsStore.getState();
  let recordingId: string | undefined;
  if (settings.autoRecordOnArm && !isRecordingFor(droneId)) {
    try {
      recordingId = startRecordingFor(droneId, droneName);
    } catch (err) {
      console.warn("[flight-lifecycle] startRecordingFor failed", err);
    }
  }

  const draft: FlightRecord = {
    id: cryptoRandomId(),
    droneId,
    droneName,
    date: startTime,
    startTime,
    endTime: startTime,
    duration: 0,
    distance: 0,
    maxAlt: 0,
    maxSpeed: 0,
    batteryUsed: 0,
    waypointCount: 0,
    status: "in_progress",
    takeoffLat: snapshot.lat,
    takeoffLon: snapshot.lon,
    recordingId,
    hasTelemetry: false,
    updatedAt: startTime,
  };

  const history = useHistoryStore.getState();
  history.addRecord(draft);
  void history.persistToIDB();

  _state.set(droneId, { armed: true, draftRecordId: draft.id, recordingId });
}

async function handleDisarm(droneId: string): Promise<void> {
  const lc = _state.get(droneId);
  if (!lc) return;
  _state.set(droneId, { ...lc, armed: false });

  if (!lc.draftRecordId) return;

  // Stop the recorder slot, if any.
  let frames: TelemetryFrame[] = [];
  if (lc.recordingId && isRecordingFor(droneId)) {
    try {
      const recording = await stopRecordingFor(droneId);
      if (recording) {
        frames = await loadRecordingFrames(recording.id);
      }
    } catch (err) {
      console.warn("[flight-lifecycle] stopRecordingFor failed", err);
    }
  }

  const stats = computeFlightStats(frames);
  const endTime = Date.now();
  const history = useHistoryStore.getState();
  history.updateRecord(lc.draftRecordId, {
    endTime,
    duration: Math.max(0, Math.round((endTime - (history.records.find((r) => r.id === lc.draftRecordId)?.startTime ?? endTime)) / 1000)),
    distance: stats.distance,
    maxAlt: stats.maxAlt,
    maxSpeed: stats.maxSpeed,
    avgSpeed: stats.avgSpeed,
    batteryStartV: stats.batteryStartV,
    batteryEndV: stats.batteryEndV,
    batteryUsed: stats.batteryUsed,
    path: stats.path,
    landingLat: stats.landingLat,
    landingLon: stats.landingLon,
    status: "completed",
    hasTelemetry: frames.length > 0,
  });
  void history.persistToIDB();

  _state.delete(droneId);
}

// ── Stat computation ─────────────────────────────────────────

interface FlightStats {
  distance: number;
  maxAlt: number;
  maxSpeed: number;
  avgSpeed: number;
  batteryStartV?: number;
  batteryEndV?: number;
  batteryUsed: number;
  path: [number, number][];
  landingLat?: number;
  landingLon?: number;
}

interface PositionFrameData { lat: number; lon: number; relativeAlt?: number; alt?: number; groundSpeed?: number }
interface BatteryFrameData { voltage: number; remaining: number }
interface VfrFrameData { groundspeed: number; alt?: number }

/**
 * Walk recorded frames once and derive flight stats.
 *
 * Pure function — no I/O. Tests deferred to Phase 28.
 */
export function computeFlightStats(frames: TelemetryFrame[]): FlightStats {
  let distance = 0;
  let maxAlt = 0;
  let maxSpeed = 0;
  let speedSum = 0;
  let speedCount = 0;
  let batteryStartV: number | undefined;
  let batteryEndV: number | undefined;
  let batteryStartPct: number | undefined;
  let batteryEndPct: number | undefined;
  let landingLat: number | undefined;
  let landingLon: number | undefined;
  let prevLat: number | undefined;
  let prevLon: number | undefined;

  // Path downsample: 1 sample per ~1 s, max 1000 points.
  const path: [number, number][] = [];
  let lastPathTimeMs = -Infinity;
  const PATH_INTERVAL_MS = 1000;
  const PATH_MAX = 1000;

  for (const frame of frames) {
    if (frame.channel === "position" || frame.channel === "globalPosition") {
      const d = frame.data as PositionFrameData;
      if (typeof d.lat === "number" && typeof d.lon === "number") {
        if (prevLat !== undefined && prevLon !== undefined) {
          distance += haversineMeters(prevLat, prevLon, d.lat, d.lon);
        }
        prevLat = d.lat;
        prevLon = d.lon;
        landingLat = d.lat;
        landingLon = d.lon;

        const altCandidate = typeof d.relativeAlt === "number" ? d.relativeAlt : d.alt ?? 0;
        if (altCandidate > maxAlt) maxAlt = altCandidate;

        if (typeof d.groundSpeed === "number" && d.groundSpeed > 0) {
          if (d.groundSpeed > maxSpeed) maxSpeed = d.groundSpeed;
          speedSum += d.groundSpeed;
          speedCount += 1;
        }

        if (frame.offsetMs - lastPathTimeMs >= PATH_INTERVAL_MS && path.length < PATH_MAX) {
          path.push([d.lat, d.lon]);
          lastPathTimeMs = frame.offsetMs;
        }
      }
    } else if (frame.channel === "vfr") {
      const d = frame.data as VfrFrameData;
      if (typeof d.groundspeed === "number" && d.groundspeed > 0) {
        if (d.groundspeed > maxSpeed) maxSpeed = d.groundspeed;
        speedSum += d.groundspeed;
        speedCount += 1;
      }
      if (typeof d.alt === "number" && d.alt > maxAlt) maxAlt = d.alt;
    } else if (frame.channel === "battery") {
      const d = frame.data as BatteryFrameData;
      if (typeof d.voltage === "number") {
        if (batteryStartV === undefined) batteryStartV = d.voltage;
        batteryEndV = d.voltage;
      }
      if (typeof d.remaining === "number") {
        if (batteryStartPct === undefined) batteryStartPct = d.remaining;
        batteryEndPct = d.remaining;
      }
    }
  }

  let batteryUsed = 0;
  if (batteryStartPct !== undefined && batteryEndPct !== undefined) {
    batteryUsed = Math.max(0, Math.round(batteryStartPct - batteryEndPct));
  } else if (batteryEndPct !== undefined) {
    batteryUsed = Math.max(0, Math.round(100 - batteryEndPct));
  }

  return {
    distance: Math.round(distance),
    maxAlt: Math.round(maxAlt),
    maxSpeed: Math.round(maxSpeed * 10) / 10,
    avgSpeed: speedCount > 0 ? Math.round((speedSum / speedCount) * 10) / 10 : 0,
    batteryStartV,
    batteryEndV,
    batteryUsed,
    path,
    landingLat,
    landingLon,
  };
}

// ── Geo helper ───────────────────────────────────────────────

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

// ── ID helper ────────────────────────────────────────────────

function cryptoRandomId(): string {
  // crypto.randomUUID is available in modern browsers and Node 19+.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `flt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
