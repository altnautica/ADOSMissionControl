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
