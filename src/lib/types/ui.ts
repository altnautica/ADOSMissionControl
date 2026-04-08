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
