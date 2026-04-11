/**
 * Flight summarizer — generates a 2-3 sentence natural-language summary
 * from a FlightRecord's stats, events, and flags.
 *
 * Works entirely offline via rule-based templates. No external API required.
 *
 * Phase 22 — AI summary.
 *
 * @module ai/flight-summarizer
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "../types";

/**
 * Generate a concise human-readable summary of a flight.
 * Returns 2-3 sentences covering: what happened, key stats, and notable events.
 */
export function summarizeFlight(record: FlightRecord): string {
  const parts: string[] = [];

  // Opening — what drone, when, where, how long
  const drone = record.customName ?? record.droneName;
  const dateStr = new Date(record.startTime ?? record.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const durationMin = Math.round(record.duration / 60);
  const distKm = (record.distance / 1000).toFixed(1);
  const place = record.takeoffPlaceName ? ` from ${record.takeoffPlaceName}` : "";

  parts.push(
    `${drone} flew a ${durationMin}-minute ${record.status} flight on ${dateStr}${place}, covering ${distKm} km.`,
  );

  // Key stats
  const statParts: string[] = [];
  if (record.maxAlt > 0) statParts.push(`${record.maxAlt.toFixed(0)} m max altitude`);
  if (record.maxSpeed > 0) statParts.push(`${record.maxSpeed.toFixed(1)} m/s top speed`);
  if (record.batteryUsed > 0) statParts.push(`${record.batteryUsed.toFixed(0)}% battery used`);
  if (statParts.length > 0) {
    parts.push(`Reached ${statParts.join(", ")}.`);
  }

  // Notable events and flags
  const notable: string[] = [];
  const errorEvents = record.events?.filter((e) => e.severity === "error") ?? [];
  const warningEvents = record.events?.filter((e) => e.severity === "warning") ?? [];
  const errorFlags = record.flags?.filter((f) => f.severity === "error") ?? [];
  const warningFlags = record.flags?.filter((f) => f.severity === "warning") ?? [];

  if (errorEvents.length > 0) {
    notable.push(`${errorEvents.length} critical event${errorEvents.length > 1 ? "s" : ""} (${errorEvents.map((e) => e.label).slice(0, 3).join(", ")})`);
  }
  if (warningEvents.length > 0) {
    notable.push(`${warningEvents.length} warning${warningEvents.length > 1 ? "s" : ""}`);
  }
  if (errorFlags.length > 0) {
    notable.push(errorFlags.map((f) => f.message).slice(0, 2).join("; "));
  } else if (warningFlags.length > 0) {
    notable.push(warningFlags.map((f) => f.message).slice(0, 2).join("; "));
  }

  if (notable.length > 0) {
    parts.push(`Flagged: ${notable.join(". ")}.`);
  } else if (record.status === "completed") {
    parts.push("No anomalies detected.");
  }

  // Geofence breaches
  if (record.geofenceBreaches && record.geofenceBreaches.length > 0) {
    parts.push(`${record.geofenceBreaches.length} geofence breach${record.geofenceBreaches.length > 1 ? "es" : ""} detected.`);
  }

  // Wind
  if (record.windEstimate) {
    parts.push(`Estimated wind ${record.windEstimate.speedMs.toFixed(1)} m/s from ${record.windEstimate.fromDirDeg}°.`);
  }

  return parts.join(" ");
}

/**
 * Suggest tags for a flight based on its properties.
 */
export function suggestTags(record: FlightRecord): string[] {
  const tags: string[] = [];

  // Suite
  if (record.suiteType) tags.push(record.suiteType);

  // Status-based
  if (record.status === "emergency") tags.push("emergency");
  if (record.status === "aborted") tags.push("aborted");

  // Duration buckets
  if (record.duration > 1800) tags.push("long-flight");
  else if (record.duration < 120) tags.push("short-flight");

  // Distance
  if (record.distance > 10000) tags.push("long-range");

  // Altitude
  if (record.maxAlt > 100) tags.push("high-altitude");

  // Anomalies
  const hasErrors = (record.flags?.some((f) => f.severity === "error")) ?? false;
  if (hasErrors) tags.push("incident");

  // Geofence
  if (record.geofenceBreaches && record.geofenceBreaches.length > 0) {
    tags.push("geofence-breach");
  }

  // Weather
  if (record.windEstimate && record.windEstimate.speedMs > 8) {
    tags.push("high-wind");
  }

  // Location
  if (record.locality) tags.push(record.locality.toLowerCase().replace(/\s+/g, "-"));

  // Night
  if (record.sunMoon?.daylightPhase === "night") tags.push("night-ops");

  return tags;
}
