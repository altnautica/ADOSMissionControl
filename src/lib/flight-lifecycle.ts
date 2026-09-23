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
 * This file owns the state-machine core. Helpers live in the
 * flight-lifecycle/ folder: `geo` (id), `stats` (flight-stat
 * derivation), `snapshots` (preflight + geofence capture).
 *
 * @module flight-lifecycle
 * @license GPL-3.0-only
 */

import {
  startRecordingFor,
  stopRecordingFor,
  activeRecordingFor,
  loadRecordingFrames,
  recordingFramesBetween,
  saveFlightRecording,
  type TelemetryFrame,
} from "./telemetry-recorder";
import { useHistoryStore } from "@/stores/history-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { useLoadoutStore } from "@/stores/loadout-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { analyzeFlight } from "./flight-analysis/analyzer";
import { detectPhases } from "./flight-analysis/phase-detector";
import { computeAdherence } from "./flight-analysis/mission-adherence";
import { detectGeofenceBreaches } from "./flight-analysis/geofence-forensics";
import { estimateWind } from "./flight-analysis/wind-estimator";
import { useMissionStore } from "@/stores/mission-store";
import { computeSunMoon } from "./environment/sun-moon";
import { getWeatherSnapshot } from "./environment/weather-provider";
import { reverseGeocode } from "./geocoding/reverse";
import { haversineDistance } from "@/lib/geo/distance";
import type { FlightRecord, LoadoutSnapshot, SysStatusData } from "./types";
import { cryptoRandomId } from "./flight-lifecycle/geo";
import { computeFlightStats } from "./flight-lifecycle/stats";
import {
  capturePreflightSnapshot,
  captureGeofenceSnapshot,
} from "./flight-lifecycle/snapshots";

// Re-export for external consumers (typed FlightStats shape).
export { computeFlightStats } from "./flight-lifecycle/stats";
export type { FlightStats } from "./flight-lifecycle/stats";

// ── Per-drone lifecycle state ────────────────────────────────

interface DroneLifecycleState {
  armed: boolean;
  draftRecordId?: string;
  droneName?: string;
  armTime?: number;
  /** The recording this lifecycle started at arm; stopped at disarm. */
  ownRecordingId?: string;
  /** A recording already running at arm (connect or REC); the flight is cut from it. */
  sharedRecordingId?: string;
}

export interface ArmSnapshot {
  /** Last-known position (lat, lon) for takeoff / landing coords. Optional. */
  lat?: number;
  lon?: number;
  /** Last-known GPS fix type of this drone; below 2 means no position fix. */
  gpsFixType?: number;
  /** This drone's latest SYS_STATUS, for the preflight sensor bitmasks. */
  sysStatus?: SysStatusData;
  /**
   * True when this drone is the operator's selected drone. The geofence
   * editor holds the selected drone's fence, so only its record gets it.
   */
  selected?: boolean;
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

/** The pilot, aircraft and loadout fields frozen into a record at arm. */
function operatorSnapshot(droneId: string, droneName: string): Partial<FlightRecord> {
  const profile = useOperatorProfileStore.getState().profile;
  const aircraft = useAircraftRegistryStore.getState().getOrCreate(droneId, droneName);
  const loadout: LoadoutSnapshot | undefined = useLoadoutStore.getState().get(droneId);
  return {
    pilotFirstName: profile.pilotFirstName,
    pilotLastName: profile.pilotLastName,
    pilotLicenseNumber: profile.pilotLicenseNumber,
    pilotLicenseIssuer: profile.pilotLicenseIssuer,
    aircraftRegistration: aircraft.registrationNumber,
    aircraftSerial: aircraft.serialNumber,
    aircraftMtomKg: aircraft.mtomKg,
    loadout,
  };
}

function handleArm(droneId: string, droneName: string, snapshot: ArmSnapshot): void {
  const startTime = Date.now();

  // A recording already running for this drone (record-on-connect, the REC
  // button) carries this flight's frames; disarm cuts the flight out of it.
  // Otherwise the lifecycle optionally starts its own.
  const settings = useSettingsStore.getState();
  const sharedRecordingId = activeRecordingFor(droneId)?.recordingId;
  let ownRecordingId: string | undefined;
  if (!sharedRecordingId && settings.autoRecordOnArm) {
    try {
      ownRecordingId = startRecordingFor(droneId, droneName);
    } catch (err) {
      console.warn("[flight-lifecycle] startRecordingFor failed", err);
    }
  }

  // A 0,0 position or a GPS without a fix is "no position yet", not a
  // takeoff point: the autopilot reports zeros before it has an estimate.
  // Disarm fills the site in from the landing coordinates instead.
  const armPosition =
    snapshot.lat !== undefined &&
    snapshot.lon !== undefined &&
    !(snapshot.lat === 0 && snapshot.lon === 0) &&
    (snapshot.gpsFixType === undefined || snapshot.gpsFixType >= 2)
      ? { lat: snapshot.lat, lon: snapshot.lon }
      : undefined;

  // Freeze pilot + aircraft + loadout snapshots into the new record so
  // future compliance exports keep working even if the operator edits
  // these fields later.
  const frozen = operatorSnapshot(droneId, droneName);

  // Freeze the pre-flight checklist + prearm bitmask snapshot.
  const preflight = capturePreflightSnapshot(droneId, snapshot.sysStatus);

  // Sun / moon snapshot at arm time, iff we have a position fix.
  // Disarm will retry with landing coords when arm had no lock.
  const sunMoon = armPosition ? computeSunMoon(armPosition.lat, armPosition.lon, startTime) : undefined;

  // Freeze the active mission's id + name + waypoint snapshot so the
  // disarm-time adherence calc has something to compare against, even
  // if the user clears the mission mid-flight or the app crashes.
  const activeMission = useMissionStore.getState().activeMission;
  const missionId = activeMission?.id;
  const missionName = activeMission?.name;
  const missionWaypoints = activeMission?.waypoints?.map((w) => ({
    lat: w.lat,
    lon: w.lon,
    alt: w.alt,
  }));

  // Freeze the geofence snapshot at arm time so disarm forensics can
  // detect breaches even if the user edits the fence after the flight
  // ends. The fence editor belongs to the selected drone.
  const geofenceSnapshot = snapshot.selected ? captureGeofenceSnapshot() : undefined;

  const draft: FlightRecord = {
    id: cryptoRandomId(),
    droneId,
    droneName,
    date: startTime,
    startTime,
    endTime: startTime,
    duration: 0,
    waypointCount: 0,
    status: "in_progress",
    takeoffLat: armPosition?.lat,
    takeoffLon: armPosition?.lon,
    recordingId: ownRecordingId,
    hasTelemetry: false,
    updatedAt: startTime,
    ...frozen,
    preflight,
    sunMoon,
    missionId,
    missionName,
    missionWaypoints,
    geofenceSnapshot,
  };

  const history = useHistoryStore.getState();
  history.addRecord(draft);
  void history.persistToIDB();

  _state.set(droneId, {
    armed: true,
    draftRecordId: draft.id,
    droneName,
    armTime: startTime,
    ownRecordingId,
    sharedRecordingId,
  });

  // An arm before the stores finished loading from IndexedDB froze empty
  // pilot/aircraft/loadout fields. Freeze them again once loaded.
  const draftId = draft.id;
  void Promise.all([
    useOperatorProfileStore.getState().ensureLoaded(),
    useAircraftRegistryStore.getState().ensureLoaded(),
    useLoadoutStore.getState().ensureLoaded(),
  ]).then(() => {
    const loaded = operatorSnapshot(droneId, droneName);
    if (JSON.stringify(loaded) === JSON.stringify(frozen)) return;
    const store = useHistoryStore.getState();
    if (!store.records.some((r) => r.id === draftId)) return;
    store.updateRecord(draftId, loaded);
    void store.persistToIDB();
  });

  // Non-blocking METAR fetch. Fires async from the nearest
  // aviationweather.gov station within 300 km. Resolves (or doesn't) on
  // its own schedule and patches the record; never awaits here, never
  // blocks the arm path, and never throws.
  if (armPosition) {
    void getWeatherSnapshot(armPosition.lat, armPosition.lon, startTime).then((weather) => {
      if (!weather) return;
      const store = useHistoryStore.getState();
      // Only patch if the record still exists (user may have deleted it).
      if (!store.records.some((r) => r.id === draftId)) return;
      store.updateRecord(draftId, { weatherSnapshot: weather });
      void store.persistToIDB();
    });

    // Non-blocking reverse geocode for a human-readable takeoff place
    // name. Throttled 1 req/s, IDB-cached indefinitely.
    void reverseGeocode(armPosition.lat, armPosition.lon).then((place) => {
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
}

async function handleDisarm(droneId: string): Promise<void> {
  const lc = _state.get(droneId);
  if (!lc) return;
  _state.set(droneId, { ...lc, armed: false });

  if (!lc.draftRecordId) return;
  const endTime = Date.now();

  // The flight's frames: the lifecycle's own recording, or this flight's
  // span of a recording that was already running at arm.
  let frames: TelemetryFrame[] = [];
  let recordingId = lc.ownRecordingId;
  try {
    if (lc.ownRecordingId) {
      if (activeRecordingFor(droneId)?.recordingId === lc.ownRecordingId) {
        await stopRecordingFor(droneId);
      }
      frames = await loadRecordingFrames(lc.ownRecordingId);
    } else if (lc.sharedRecordingId && lc.armTime !== undefined) {
      frames = await recordingFramesBetween(droneId, lc.sharedRecordingId, lc.armTime, endTime);
      if (frames.length > 0) {
        const saved = await saveFlightRecording(frames, {
          droneId,
          droneName: lc.droneName,
          startTimeMs: lc.armTime,
        });
        recordingId = saved.id;
      }
    }
  } catch (err) {
    console.warn("[flight-lifecycle] loading the flight's frames failed", err);
  }

  const stats = computeFlightStats(frames);
  const analysis = frames.length > 0 ? analyzeFlight(frames) : { events: [], flags: [], health: {} };
  const phases = frames.length > 0 ? detectPhases(frames) : [];
  // Compute mission adherence using the path we just derived and the
  // waypoint snapshot we froze on arm.
  const draftRowEarly = useHistoryStore.getState().records.find((r) => r.id === lc.draftRecordId);
  const adherence =
    draftRowEarly?.missionWaypoints && stats.path.length >= 2
      ? computeAdherence(stats.path, draftRowEarly.missionWaypoints) ?? undefined
      : undefined;
  // Geofence breach detection against the snapshot frozen on arm.
  const geofenceBreaches =
    draftRowEarly?.geofenceSnapshot && stats.path.length >= 2
      ? detectGeofenceBreaches(stats.path, draftRowEarly.geofenceSnapshot, stats.maxAlt)
      : undefined;
  // Wind: the autopilot's own estimate, or ground track minus airspeed.
  const windEstimate = frames.length > 0 ? estimateWind(frames) : undefined;
  const history = useHistoryStore.getState();
  // Roll up aircraft usage stats.
  const draftRow = history.records.find((r) => r.id === lc.draftRecordId);
  const flightSeconds = draftRow ? Math.max(0, Math.round((endTime - draftRow.startTime) / 1000)) : 0;
  if (flightSeconds > 0) {
    useAircraftRegistryStore.getState().recordFlight(droneId, flightSeconds);

    // Roll usage stats into the loadout's batteries + equipment.
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
  // Sun/moon retry: if arm didn't have a position lock, compute now from
  // landing coords (which are from the same flight site within the
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

  // Weather retry: if the arm-time async fetch didn't land (network was
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

  // Geocode retry: if arm-time geocode didn't land, retry with landing coords.
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

  // Landing-place check: if landing is >5 km from takeoff, the user flew
  // to a distinctly different location — capture a second place name for
  // the landing spot.
  if (
    draftRow?.takeoffLat !== undefined &&
    draftRow?.takeoffLon !== undefined &&
    stats.landingLat !== undefined &&
    stats.landingLon !== undefined &&
    draftRow &&
    haversineDistance(draftRow.takeoffLat, draftRow.takeoffLon, stats.landingLat, stats.landingLon) > 5000
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
    // With no recorded frames nothing was measured: the stats stay unset
    // and render as "—", never as a flown 0 km / 0 m.
    distance: frames.length > 0 ? stats.distance : undefined,
    maxAlt: frames.length > 0 ? stats.maxAlt : undefined,
    maxSpeed: frames.length > 0 ? stats.maxSpeed : undefined,
    avgSpeed: frames.length > 0 ? stats.avgSpeed : undefined,
    batteryStartV: stats.batteryStartV,
    batteryEndV: stats.batteryEndV,
    batteryUsed: stats.batteryUsed,
    path: stats.path,
    landingLat: stats.landingLat,
    landingLon: stats.landingLon,
    status: "completed",
    recordingId,
    hasTelemetry: frames.length > 0,
    events: analysis.events,
    flags: analysis.flags,
    health: analysis.health,
    sunMoon: sunMoonPatch,
    phases: phases.length > 0 ? phases : undefined,
    adherence,
    geofenceBreaches: geofenceBreaches && geofenceBreaches.length > 0 ? geofenceBreaches : undefined,
    windEstimate,
  });
  void history.persistToIDB();

  // A quick re-arm while this flight was finalizing already stored the next
  // flight's state; it is not this handler's to delete.
  if (_state.get(droneId)?.draftRecordId === lc.draftRecordId) _state.delete(droneId);
}
