/**
 * @module cockpit/bottom-row
 * @description The cockpit bottom row (`layout.json` zone `bottom_row`):
 * D (horizontal distance to home), H (height above home), H.S (horizontal
 * speed), V.S (vertical speed) and AGL (height above the ground). Every value
 * is null when no fresh sample backs it; the row renders the no-data glyph.
 *
 * AGL is the ADOS pilot's `agl_m` only while a fresh pilot state says it
 * came from a rangefinder (`agl_source: "rangefinder"`); its height-above-home
 * fallback is not a height above the ground and is never shown as one.
 * Otherwise a downward rangefinder (DISTANCE_SENSOR orientation 25, within
 * its valid range) first, then the FC's terrain report, else no data. When
 * the pilot's rangefinder AGL has gone stale the cell shows no data rather
 * than falling through to a fallback source that may read 0 m.
 *
 * @license GPL-3.0-only
 */

import { haversineDistance } from "@/lib/geo/distance";

/** MAV_SENSOR_ROTATION_PITCH_270: a downward-facing sensor. */
export const SENSOR_DOWN = 25;

export interface BottomRowInputs {
  position: { lat: number; lon: number; relativeAlt?: number; groundSpeed?: number; climbRate?: number } | null;
  vfr: { groundspeed: number; climb: number } | null;
  home: { lat: number; lon: number } | null;
  /** DISTANCE_SENSOR samples (distances in cm). */
  rangefinder: { currentDistance: number; minDistance: number; maxDistance: number; orientation: number } | null;
  terrain: { currentHeight: number } | null;
  /** The pilot kind's `agl_m`, null when the pilot state is stale or absent. */
  pilotAglM: number | null;
  /** The pilot kind's `agl_source`; only "rangefinder" is a height above the ground. */
  pilotAglSource?: string | null;
  /** The pilot was supplying a rangefinder AGL and its state has gone stale. */
  pilotAglStale?: boolean;
}

export interface BottomRowValues {
  distM: number | null;
  heightM: number | null;
  hSpeedMps: number | null;
  vSpeedMps: number | null;
  aglM: number | null;
}

export function bottomRowValues(i: BottomRowInputs): BottomRowValues {
  const pos = i.position && (i.position.lat !== 0 || i.position.lon !== 0) ? i.position : null;
  const distM = pos && i.home ? haversineDistance(i.home.lat, i.home.lon, pos.lat, pos.lon) : null;
  const heightM = typeof pos?.relativeAlt === "number" ? pos.relativeAlt : null;
  const hSpeedMps = i.vfr?.groundspeed ?? pos?.groundSpeed ?? null;
  const vSpeedMps = i.vfr?.climb ?? pos?.climbRate ?? null;
  return {
    distM,
    heightM,
    hSpeedMps,
    vSpeedMps,
    aglM: i.pilotAglStale
      ? null
      : (i.pilotAglSource === "rangefinder" ? i.pilotAglM : null) ?? aglFrom(i.rangefinder, i.terrain),
  };
}

function aglFrom(rf: BottomRowInputs["rangefinder"], terrain: BottomRowInputs["terrain"]): number | null {
  if (
    rf &&
    rf.orientation === SENSOR_DOWN &&
    rf.currentDistance >= rf.minDistance &&
    rf.currentDistance <= rf.maxDistance &&
    rf.maxDistance > 0
  ) {
    return rf.currentDistance / 100;
  }
  if (terrain && Number.isFinite(terrain.currentHeight)) return terrain.currentHeight;
  return null;
}
