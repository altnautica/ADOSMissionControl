/**
 * @module telemetry-utils
 * @description Telemetry unit conversion, formatting, and geospatial calculation utilities.
 * Includes bearing, path distance, and common unit conversions.
 * @license GPL-3.0-only
 */

import { haversineDistance } from "@/lib/geo/distance";

/** Meters per second to km/h. */
export function mpsToKph(mps: number): number {
  return mps * 3.6;
}

/** Meters per second to knots. */
export function mpsToKnots(mps: number): number {
  return mps * 1.94384;
}

/** Meters to feet. */
export function metersToFeet(m: number): number {
  return m * 3.28084;
}

/** Degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Radians to degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalize heading to 0-360. */
export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

/** Format altitude with unit. */
export function formatAlt(meters: number): string {
  return `${meters.toFixed(1)}m`;
}

/** Format speed with unit. */
export function formatSpeed(mps: number): string {
  return `${mpsToKph(mps).toFixed(1)} km/h`;
}

/** Format heading as 3-digit compass. */
export function formatHeading(deg: number): string {
  return String(Math.round(normalizeHeading(deg))).padStart(3, "0") + "\u00B0";
}

/** Format battery percentage. */
export function formatBattery(pct: number): string {
  return `${Math.round(pct)}%`;
}

/** Format GPS coordinates to decimal degrees. */
export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

/** Calculate total path distance for an array of waypoints in meters. */
export function totalPathDistance(waypoints: { lat: number; lon: number }[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineDistance(
      waypoints[i - 1].lat, waypoints[i - 1].lon,
      waypoints[i].lat, waypoints[i].lon
    );
  }
  return total;
}

/** Calculate bearing between two GPS points in degrees. */
export function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = degToRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(degToRad(lat2));
  const x =
    Math.cos(degToRad(lat1)) * Math.sin(degToRad(lat2)) -
    Math.sin(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.cos(dLon);
  return normalizeHeading(radToDeg(Math.atan2(y, x)));
}
