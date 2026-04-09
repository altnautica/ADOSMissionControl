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
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { useLoadoutStore } from "@/stores/loadout-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { useChecklistStore } from "@/stores/checklist-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";
import { analyzeFlight } from "./flight-analysis/analyzer";
import { detectPhases } from "./flight-analysis/phase-detector";
import { computeSunMoon } from "./environment/sun-moon";
import { getWeatherSnapshot } from "./environment/weather-provider";
import { captureAirspaceSnapshot } from "./environment/airspace-snapshot";
import { reverseGeocode, haversineKmLocal } from "./geocoding/reverse";
import type {
  FlightRecord,
  LoadoutSnapshot,
  PreflightSnapshot,
  PreflightChecklistItem,
} from "./types";

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

  // Phase 7a — freeze pilot + aircraft snapshots into the new record so
  // future compliance exports keep working even if the operator edits these
  // fields later.
  const profile = useOperatorProfileStore.getState().profile;
  const aircraft = useAircraftRegistryStore.getState().getOrCreate(droneId, droneName);

  // Phase 12c — freeze the user's pre-flight loadout selection.
  const loadout: LoadoutSnapshot | undefined = useLoadoutStore.getState().get(droneId);

  // Phase 13 — freeze the pre-flight checklist + prearm bitmask snapshot.
  const preflight = capturePreflightSnapshot(droneId);

  // Phase 14a — sun / moon snapshot at arm time, iff we have a position fix.
  // Disarm will retry with landing coords when arm had no lock.
  const sunMoon =
    snapshot.lat !== undefined && snapshot.lon !== undefined
      ? computeSunMoon(snapshot.lat, snapshot.lon, startTime)
      : undefined;

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
    pilotFirstName: profile.pilotFirstName,
    pilotLastName: profile.pilotLastName,
    pilotLicenseNumber: profile.pilotLicenseNumber,
    pilotLicenseIssuer: profile.pilotLicenseIssuer,
    aircraftRegistration: aircraft.registrationNumber,
    aircraftSerial: aircraft.serialNumber,
    aircraftMtomKg: aircraft.mtomKg,
    loadout,
    preflight,
    sunMoon,
  };

  const history = useHistoryStore.getState();
  history.addRecord(draft);
  void history.persistToIDB();

  _state.set(droneId, { armed: true, draftRecordId: draft.id, recordingId });

  // Phase 14b — non-blocking METAR fetch. Fires async from the nearest
  // aviationweather.gov station within 300 km. Resolves (or doesn't) on
  // its own schedule and patches the record; never awaits here, never
  // blocks the arm path, and never throws.
  if (snapshot.lat !== undefined && snapshot.lon !== undefined) {
    const draftId = draft.id;
    void getWeatherSnapshot(snapshot.lat, snapshot.lon, startTime).then((weather) => {
      if (!weather) return;
      const store = useHistoryStore.getState();
      // Only patch if the record still exists (user may have deleted it).
      if (!store.records.some((r) => r.id === draftId)) return;
      store.updateRecord(draftId, { weatherSnapshot: weather });
      void store.persistToIDB();
    });

    // Phase 15 — non-blocking reverse geocode for a human-readable takeoff
    // place name. Throttled 1 req/s, IDB-cached indefinitely.
    const draftId15 = draft.id;
    const armLat = snapshot.lat;
    const armLon = snapshot.lon;
    void reverseGeocode(armLat, armLon).then((place) => {
      if (!place) return;
      const store = useHistoryStore.getState();
      if (!store.records.some((r) => r.id === draftId15)) return;
      store.updateRecord(draftId15, {
        takeoffPlaceName: place.placeName,
        country: place.country,
        region: place.region,
        locality: place.locality,
      });
      void store.persistToIDB();
    });
  }
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
  const analysis = frames.length > 0 ? analyzeFlight(frames) : { events: [], flags: [], health: {} };
  const phases = frames.length > 0 ? detectPhases(frames) : [];
  const endTime = Date.now();
  const history = useHistoryStore.getState();
  // Roll up aircraft usage stats (Phase 7a).
  const draftRow = history.records.find((r) => r.id === lc.draftRecordId);
  const flightSeconds = draftRow ? Math.max(0, Math.round((endTime - draftRow.startTime) / 1000)) : 0;
  if (flightSeconds > 0) {
    useAircraftRegistryStore.getState().recordFlight(droneId, flightSeconds);

    // Phase 12c — roll usage stats into the loadout's batteries + equipment.
    const loadout = draftRow?.loadout;
    if (loadout) {
      const batteryStore = useBatteryRegistryStore.getState();
      for (const batteryId of loadout.batteryIds ?? []) {
        batteryStore.recordCycle(batteryId);
      }
      const equipmentStore = useEquipmentRegistryStore.getState();
      const equipmentIds = [
        loadout.propSetId,
        loadout.motorSetId,
        loadout.escSetId,
        loadout.cameraId,
        loadout.gimbalId,
        loadout.payloadId,
        loadout.frameId,
        loadout.rcTxId,
      ].filter((id): id is string => typeof id === "string" && id.length > 0);
      for (const equipmentId of equipmentIds) {
        equipmentStore.recordFlight(equipmentId, flightSeconds);
      }
    }
  }
  // Phase 14a retry: if arm didn't have a position lock, compute sun/moon
  // now from landing coords (which are from the same flight site within the
  // typical flight's flight-duration, so the answer is still accurate).
  let sunMoonPatch = draftRow?.sunMoon;
  if (
    !sunMoonPatch &&
    stats.landingLat !== undefined &&
    stats.landingLon !== undefined &&
    draftRow
  ) {
    sunMoonPatch = computeSunMoon(stats.landingLat, stats.landingLon, draftRow.startTime);
  }

  // Phase 14b retry: if the arm-time async fetch didn't land (network was
  // down or the drone had no GPS fix at arm), fire one more attempt from
  // the landing coords. Non-blocking — we don't wait for it.
  if (
    !draftRow?.weatherSnapshot &&
    stats.landingLat !== undefined &&
    stats.landingLon !== undefined &&
    draftRow
  ) {
    const draftId = draftRow.id;
    const flightStartTime = draftRow.startTime;
    void getWeatherSnapshot(stats.landingLat, stats.landingLon, flightStartTime).then(
      (weather) => {
        if (!weather) return;
        const store = useHistoryStore.getState();
        if (!store.records.some((r) => r.id === draftId)) return;
        store.updateRecord(draftId, { weatherSnapshot: weather });
        void store.persistToIDB();
      },
    );
  }

  // Phase 15 retry: if arm-time geocode didn't land, retry with landing coords.
  if (
    !draftRow?.takeoffPlaceName &&
    stats.landingLat !== undefined &&
    stats.landingLon !== undefined &&
    draftRow
  ) {
    const draftId = draftRow.id;
    const latP = stats.landingLat;
    const lonP = stats.landingLon;
    void reverseGeocode(latP, lonP).then((place) => {
      if (!place) return;
      const store = useHistoryStore.getState();
      if (!store.records.some((r) => r.id === draftId)) return;
      store.updateRecord(draftId, {
        takeoffPlaceName: place.placeName,
        country: place.country,
        region: place.region,
        locality: place.locality,
      });
      void store.persistToIDB();
    });
  }

  // Phase 15 landing-place check: if landing is >5 km from takeoff, the
  // user flew to a distinctly different location — capture a second place
  // name for the landing spot.
  if (
    draftRow?.takeoffLat !== undefined &&
    draftRow?.takeoffLon !== undefined &&
    stats.landingLat !== undefined &&
    stats.landingLon !== undefined &&
    draftRow &&
    haversineKmLocal(draftRow.takeoffLat, draftRow.takeoffLon, stats.landingLat, stats.landingLon) > 5
  ) {
    const draftId = draftRow.id;
    const latL = stats.landingLat;
    const lonL = stats.landingLon;
    void reverseGeocode(latL, lonL).then((place) => {
      if (!place) return;
      const store = useHistoryStore.getState();
      if (!store.records.some((r) => r.id === draftId)) return;
      store.updateRecord(draftId, { landingPlaceName: place.placeName });
      void store.persistToIDB();
    });
  }

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
    events: analysis.events,
    flags: analysis.flags,
    health: analysis.health,
    sunMoon: sunMoonPatch,
    phases: phases.length > 0 ? phases : undefined,
  });
  void history.persistToIDB();

  // Phase 14c — async airspace / NOTAM / TFR snapshot. Fires after the main
  // patch lands so the record already has its final path. Non-blocking —
  // provider failures are silently tolerated.
  if (stats.path && stats.path.length >= 2 && draftRow) {
    const draftId = draftRow.id;
    const windowStart = draftRow.startTime;
    const windowEnd = endTime;
    void captureAirspaceSnapshot(stats.path, windowStart, windowEnd).then((airspace) => {
      if (!airspace) return;
      const store = useHistoryStore.getState();
      if (!store.records.some((r) => r.id === draftId)) return;
      store.updateRecord(draftId, { airspaceSnapshot: airspace });
      void store.persistToIDB();
    });
  }

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

// ── Pre-flight snapshot (Phase 13) ───────────────────────────

function capturePreflightSnapshot(droneId: string): PreflightSnapshot | undefined {
  const checklist = useChecklistStore.getState();
  const items: PreflightChecklistItem[] = checklist.items.map((i) => ({
    id: i.id,
    category: i.category,
    label: i.label,
    status: i.status,
    type: i.type,
    displayValue: i.displayValue,
  }));
  const checklistComplete = items.length > 0 && items.every((i) => i.status === "pass" || i.status === "skipped");

  // Drain the prearm STATUSTEXT buffer the bridge has been filling.
  const prearmFailures = usePrearmBufferStore.getState().drain(droneId);

  // SYS_STATUS bitmasks at arm time — these come from the latest sysStatus
  // ring buffer entry. ArduPilot stores sensor health/present/enabled bitmasks
  // here per the MAVLink SYS_STATUS message.
  const latestSys = useTelemetryStore.getState().sysStatus.latest();

  // If there's nothing to capture, return undefined to keep the FlightRecord clean.
  const hasAnything =
    items.length > 0 ||
    prearmFailures.length > 0 ||
    latestSys?.sensorsHealthy !== undefined;
  if (!hasAnything) return undefined;

  return {
    checklistSessionId: checklist.sessionId ?? undefined,
    checklistStartedAt: checklist.startedAt ?? undefined,
    checklistItems: items,
    checklistComplete,
    sysStatusHealth: latestSys?.sensorsHealthy,
    sysStatusPresent: latestSys?.sensorsPresent,
    sysStatusEnabled: latestSys?.sensorsEnabled,
    prearmFailures,
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
