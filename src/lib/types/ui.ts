/**
 * UI, view, flight history, and analytics types.
 * @module types/ui
 */

import type { SuiteType } from './mission';

// ── UI ───────────────────────────────────────────────────────

export type ViewId =
  | "dashboard"
  | "plan"
  | "simulate"
  | "history"
  | "analytics"
  | "config"
  | "wizard";

export interface PanelState {
  telemetry: boolean;
  alerts: boolean;
  chat: boolean;
}

// ── Flight History ───────────────────────────────────────────

export type FlightEventSeverity = "info" | "warning" | "error";

export interface FlightEvent {
  /** Offset from flight start in milliseconds. */
  t: number;
  /** Event type — broad enough to extend without breaking existing rows. */
  type: string;
  severity: FlightEventSeverity;
  /** Short human label. */
  label: string;
  /** Optional structured data (channel name, threshold, etc.). */
  data?: Record<string, unknown>;
}

export interface FlightFlag {
  /** Stable id for the flag rule (e.g. `vibration_high`). */
  type: string;
  severity: FlightEventSeverity;
  message: string;
  /** Optional remediation hint. */
  suggestion?: string;
}

export interface HealthSummary {
  avgSatellites?: number;
  avgHdop?: number;
  maxVibrationRms?: number;
  batteryHealthPct?: number;
}

export interface FlightRecord {
  id: string;
  droneId: string;
  droneName: string;
  suiteType?: SuiteType;
  /** Legacy timestamp field — equals startTime. Kept for back-compat with existing components. */
  date: number;
  /** Flight start (arm) wall-clock time in ms epoch. */
  startTime: number;
  /** Flight end (disarm) wall-clock time in ms epoch. Equals startTime while in_progress. */
  endTime: number;
  /** Duration in seconds. 0 while in_progress. */
  duration: number;
  /** Total ground distance in meters (haversine sum). */
  distance: number;
  /** Max altitude AGL in meters. */
  maxAlt: number;
  /** Max ground speed in m/s. */
  maxSpeed: number;
  /** Average ground speed in m/s. */
  avgSpeed?: number;
  /** Battery used percentage. */
  batteryUsed: number;
  /** Battery voltage at arm. */
  batteryStartV?: number;
  /** Battery voltage at disarm. */
  batteryEndV?: number;
  waypointCount: number;
  status: "completed" | "aborted" | "emergency" | "in_progress";
  /** Downsampled path: [lat, lon][] at ~1 Hz, max 1000 points. */
  path?: [number, number][];
  takeoffLat?: number;
  takeoffLon?: number;
  landingLat?: number;
  landingLon?: number;
  /** IndexedDB recording id from telemetry-recorder, if a recording is attached. */
  recordingId?: string;
  /** True if a non-empty telemetry recording is attached. */
  hasTelemetry?: boolean;
  /** Last mutation time in ms epoch. */
  updatedAt: number;
  /** User-set favorite flag. */
  favorite?: boolean;
  /** User-set tags (free-form labels). */
  tags?: string[];
  /** User-overridden display name. Falls back to droneName/date when unset. */
  customName?: string;
  /** Markdown notes (Phase 4 NotesTab). */
  notes?: string;
  /** Phase 5 — auto-detected events from flight analyzer. */
  events?: FlightEvent[];
  /** Phase 5 — auto-detected anomaly flags. */
  flags?: FlightFlag[];
  /** Phase 5 — health summary stats. */
  health?: HealthSummary;

  // Phase 7a — frozen pilot/aircraft snapshot at flight time. Lets historical
  // records produce compliance exports even after the operator profile or
  // aircraft registry has been edited.
  pilotFirstName?: string;
  pilotLastName?: string;
  pilotLicenseNumber?: string;
  pilotLicenseIssuer?: string;
  aircraftRegistration?: string;
  aircraftSerial?: string;
  aircraftMtomKg?: number;

  // Phase 7c-3 — sign-and-lock workflow.
  /** Wall-clock time the pilot sealed this record. */
  pilotSignedAt?: number;
  /** SHA-256 hex digest of the canonicalised record + optional signature image. */
  pilotSignatureHash?: string;

  /** Phase 9 — true if this record has been successfully synced to Convex. */
  cloudSynced?: boolean;

  /** Phase 11 — origin of this record. */
  source?: "live" | "dataflash" | "imported";
  /** Phase 11 — original `.bin` / `.ulg` / `.tlog` filename when imported. */
  sourceFilename?: string;

  /** Phase 12c — frozen loadout snapshot at arm time (battery + equipment ids). */
  loadout?: LoadoutSnapshot;

  /** Phase 13 — pre-flight checklist + prearm bitmask snapshot at arm time. */
  preflight?: PreflightSnapshot;

  /** Phase 14a — sun / moon environmental snapshot at arm time. */
  sunMoon?: SunMoonSnapshot;

  /** Phase 14b — METAR weather snapshot from the nearest reporting station. */
  weatherSnapshot?: WeatherSnapshot;
}

/**
 * METAR weather snapshot captured at arm time from the nearest aviation
 * weather station (within 300 km). Fetched async so it doesn't block the
 * arm path — undefined when the network is down or no station is in range.
 *
 * Feeds the Overview "Conditions" card and jurisdictions that care about
 * wind / visibility (insurance reporting, litigation evidence, go/no-go
 * audit trails).
 */
export interface WeatherSnapshot {
  /** ISO timestamp of the METAR observation (not the flight time). */
  observedAt: string;
  /** ICAO code of the reporting station (e.g. "VOBL", "EGLL"). */
  stationIcao: string;
  /** Friendly station name, typically "<airport>, <city>, <country>". */
  stationName?: string;
  stationLat?: number;
  stationLon?: number;
  /** Distance from the flight's arm position to the station in km. */
  stationDistanceKm?: number;
  tempC?: number;
  dewPointC?: number;
  /** Wind direction in compass degrees (0–360, 0 = calm). */
  windDirDeg?: number;
  windKts?: number;
  gustKts?: number;
  /** Horizontal visibility in statute miles. "6+" is represented as 6. */
  visibilityMi?: number;
  /** Ceiling (lowest BKN or OVC layer) in feet AGL. */
  ceilingFtAgl?: number;
  /** Altimeter setting in hectopascals (hPa). */
  altimeterHpa?: number;
  /** FAA flight category derived from ceiling + visibility. */
  flightCategory?: "VFR" | "MVFR" | "IFR" | "LIFR";
  /** Raw METAR string for audit trail. */
  rawMetar?: string;
  /** Set when the fetch or parse failed; the snapshot is still serialized so the UI can show the error. */
  error?: string;
}

/**
 * Sun + moon snapshot for the flight's arm-time position and instant.
 * Pure compute from `src/lib/environment/sun-moon.ts` — no network.
 * Feeds the Overview "Conditions" card and jurisdictions that care about
 * day-vs-night operations (EASA Open, UK CAA, CASA ReOC).
 */
export interface SunMoonSnapshot {
  /** ISO timestamp of the compute reference instant (flight startTime). */
  computedAt: string;
  /** Latitude used for the computation. */
  lat: number;
  /** Longitude used for the computation. */
  lon: number;

  // Solar day markers (ISO). Undefined near polar circles when not defined.
  sunriseIso?: string;
  sunsetIso?: string;
  /** Civil twilight start (dawn). */
  civilDawnIso?: string;
  /** Civil twilight end (dusk). */
  civilDuskIso?: string;
  goldenHourMorningStartIso?: string;
  goldenHourMorningEndIso?: string;
  goldenHourEveningStartIso?: string;
  goldenHourEveningEndIso?: string;

  /** Daylight phase at `computedAt` — classified from sun altitude. */
  daylightPhase:
    | "day"
    | "civil_twilight"
    | "nautical_twilight"
    | "astronomical_twilight"
    | "night";
  /** True iff `computedAt` fell inside either golden-hour window. */
  inGoldenHour: boolean;

  /** Sun altitude in degrees at `computedAt` (negative = below horizon). */
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;

  /** Moon phase 0..1 (0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter). */
  moonPhase: number;
  /** Fraction of the moon's visible disk illuminated (0..1). */
  moonIllumination: number;
  /** Human label such as "Waxing crescent", "Full moon". */
  moonPhaseLabel: string;
  moonAltitudeDeg: number;
  moonAzimuthDeg: number;
}

/**
 * Snapshot of the pre-flight state at arm time. Used by the History
 * Overview "Pre-flight" card and by jurisdiction validators (CASA in
 * particular requires the actual checklist contents).
 */
export interface PreflightSnapshot {
  /** Checklist session id from useChecklistStore. */
  checklistSessionId?: string;
  checklistStartedAt?: number;
  /** Each item's id + status at arm time, frozen. */
  checklistItems?: PreflightChecklistItem[];
  /** True iff every checklist item was pass or skipped. */
  checklistComplete?: boolean;
  /** Latest SYS_STATUS health bitmask at arm time. */
  sysStatusHealth?: number;
  /** Latest SYS_STATUS sensors-present bitmask at arm time. */
  sysStatusPresent?: number;
  /** Latest SYS_STATUS sensors-enabled bitmask at arm time. */
  sysStatusEnabled?: number;
  /** Recent ArduPilot STATUSTEXT lines starting with "PreArm:" (most recent ≤10). */
  prearmFailures?: string[];
}

export interface PreflightChecklistItem {
  id: string;
  category: string;
  label: string;
  status: "pending" | "pass" | "fail" | "skipped";
  type: "auto" | "manual";
  /** Captured display value for auto items at arm time (e.g. "98 sats", "12.4V"). */
  displayValue?: string;
}

/** Equipment + battery ids fitted to the drone for one specific flight. */
export interface LoadoutSnapshot {
  /** Battery pack ids (typically one for series, multiple for parallel packs). */
  batteryIds?: string[];
  propSetId?: string;
  motorSetId?: string;
  escSetId?: string;
  cameraId?: string;
  gimbalId?: string;
  payloadId?: string;
  frameId?: string;
  rcTxId?: string;
}

// ── Analytics ────────────────────────────────────────────────

export interface AnalyticsData {
  totalFlights: number;
  totalFlightTime: number;    // seconds
  totalDistance: number;       // meters
  avgFlightTime: number;       // seconds
  avgBatteryUsed: number;      // percentage
  missionSuccessRate: number;  // percentage
  flightsPerDay: { date: string; count: number }[];
  utilizationByDrone: { droneId: string; droneName: string; hours: number }[];
  batteryDegradation: { date: string; avgCapacity: number }[];
}
