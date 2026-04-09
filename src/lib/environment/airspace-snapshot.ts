/**
 * Phase 14c — airspace / NOTAM / TFR snapshot for a finalized flight.
 *
 * Consumes the existing `src/lib/airspace/` providers. Walks the flight's
 * downsampled path against every zone / NOTAM / TFR in the bounding box
 * and produces an {@link AirspaceSnapshot} that's frozen into the
 * FlightRecord at disarm.
 *
 * Pure async — never throws. Every provider call is wrapped in
 * `Promise.allSettled`, so a single provider failure does not abort the
 * snapshot. Returns `undefined` only when there is nothing to snapshot
 * (empty path or zero intersections).
 *
 * @module environment/airspace-snapshot
 * @license GPL-3.0-only
 */

import { loadAllAirspaceZones } from "@/lib/airspace/airspace-provider";
import { fetchNotams } from "@/lib/airspace/notam-provider";
import { fetchFaaTfrs } from "@/lib/airspace/faa-tfr-provider";
import type {
  AirspaceZone,
  AirspaceZoneType,
  BoundingBox,
  Notam,
  TemporaryRestriction,
} from "@/lib/airspace/types";
import type { AirspaceIntersection, AirspaceSnapshot } from "@/lib/types";

// ── Tunables ─────────────────────────────────────────────────

/** Max number of path points tested. */
const MAX_PATH_SAMPLES = 50;

/** Bounding-box margin in km around the flight path. */
const BBOX_MARGIN_KM = 5;

// ── Severity mapping ─────────────────────────────────────────

const ERROR_ZONE_TYPES: Set<AirspaceZoneType> = new Set([
  "prohibited",
  "dgcaRed",
  "tfr",
]);

const WARNING_ZONE_TYPES: Set<AirspaceZoneType> = new Set([
  "restricted",
  "casaRestricted",
  "dgcaYellow",
  "casaCaution",
]);

function zoneSeverity(type: AirspaceZoneType): AirspaceIntersection["severity"] {
  if (ERROR_ZONE_TYPES.has(type)) return "error";
  if (WARNING_ZONE_TYPES.has(type)) return "warning";
  return "info";
}

// ── Provider source tagging ──────────────────────────────────

/**
 * Derive a provider source id from the zone id. Conservative guesses,
 * good enough for display and dedupe keying.
 */
function zoneSource(zone: AirspaceZone): string {
  const id = zone.id.toLowerCase();
  if (id.startsWith("faa") || id.startsWith("us-")) return "faa";
  if (id.startsWith("dgca") || id.startsWith("in-")) return "dgca";
  if (id.startsWith("casa") || id.startsWith("au-")) return "casa";
  if (id.startsWith("icao") || id.startsWith("openaip")) return id.startsWith("icao") ? "icao" : "openaip";
  // Fall back to the airspace authority string.
  return zone.authority || "unknown";
}

// ── Path sampling ────────────────────────────────────────────

function downsample(path: [number, number][]): [number, number][] {
  if (path.length <= MAX_PATH_SAMPLES) return path;
  const step = Math.floor(path.length / MAX_PATH_SAMPLES);
  const out: [number, number][] = [];
  for (let i = 0; i < path.length; i += step) out.push(path[i]);
  if (out[out.length - 1] !== path[path.length - 1]) {
    out.push(path[path.length - 1]);
  }
  return out;
}

function computeBbox(path: [number, number][]): BoundingBox {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const [lat, lon] of path) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  // Add 5 km margin.
  const latMargin = BBOX_MARGIN_KM / 111.32;
  const midLat = (south + north) / 2;
  const lonScale = Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  const lonMargin = BBOX_MARGIN_KM / (111.32 * lonScale);
  return {
    south: south - latMargin,
    north: north + latMargin,
    west: west - lonMargin,
    east: east + lonMargin,
  };
}

// ── Point-in-zone test ───────────────────────────────────────
// Duplicated from src/lib/airspace/flyability.ts (that copy is not exported)
// to avoid modifying the airspace module for this additive phase.

const EARTH_RADIUS_M = 6_371_000;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isPointInZone(lat: number, lon: number, zone: AirspaceZone): boolean {
  if (zone.circle) {
    return haversineM(lat, lon, zone.circle.lat, zone.circle.lon) <= zone.circle.radiusM;
  }
  const coords =
    zone.geometry.type === "Polygon"
      ? zone.geometry.coordinates[0]
      : zone.geometry.coordinates[0]?.[0];
  if (!coords || coords.length < 3) return false;

  // Ray-casting polygon membership. Coordinates are [lon, lat] per GeoJSON.
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][1];
    const yi = coords[i][0];
    const xj = coords[j][1];
    const yj = coords[j][0];
    if ((yi > lon) !== (yj > lon) && lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function isPointInTfr(lat: number, lon: number, tfr: TemporaryRestriction): boolean {
  const coords = tfr.geometry.coordinates[0];
  if (!coords || coords.length < 3) return false;
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][1];
    const yi = coords[i][0];
    const xj = coords[j][1];
    const yj = coords[j][0];
    if ((yi > lon) !== (yj > lon) && lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── NOTAM proximity test ─────────────────────────────────────

function isNotamNearby(lat: number, lon: number, notam: Notam): boolean {
  if (notam.lat === undefined || notam.lon === undefined) return false;
  const radiusM = (notam.radius ?? 10) * 1000;
  return haversineM(lat, lon, notam.lat, notam.lon) <= radiusM;
}

// ── Main entry ───────────────────────────────────────────────

/**
 * Build an airspace snapshot for a finalized flight. Returns undefined
 * when nothing intersected or when every provider failed.
 */
export async function captureAirspaceSnapshot(
  path: [number, number][],
  windowStartMs: number,
  windowEndMs: number,
): Promise<AirspaceSnapshot | undefined> {
  if (!path || path.length < 2) return undefined;

  const samples = downsample(path);
  const bbox = computeBbox(path);

  // Fire all three provider queries in parallel. Any one failing doesn't
  // abort the others.
  const [zonesResult, notamsResult, tfrsResult] = await Promise.allSettled([
    loadAllAirspaceZones(bbox),
    fetchNotams(bbox),
    fetchFaaTfrs(bbox),
  ]);

  const zones: AirspaceZone[] = zonesResult.status === "fulfilled" ? zonesResult.value : [];
  const notams: Notam[] = notamsResult.status === "fulfilled" ? notamsResult.value : [];
  const tfrs: TemporaryRestriction[] = tfrsResult.status === "fulfilled" ? tfrsResult.value : [];

  // If every provider failed outright (all three rejected), return undefined.
  if (
    zonesResult.status === "rejected" &&
    notamsResult.status === "rejected" &&
    tfrsResult.status === "rejected"
  ) {
    return undefined;
  }

  // ── Intersect ─────────────────────────────────────────────

  const intersections = new Map<string, AirspaceIntersection>();

  // Zones — any sample inside any zone polygon / circle.
  for (const zone of zones) {
    const hit = samples.some(([lat, lon]) => isPointInZone(lat, lon, zone));
    if (!hit) continue;
    const key = `${zoneSource(zone)}:${zone.id}`;
    if (intersections.has(key)) continue;
    intersections.set(key, {
      id: zone.id,
      kind: "zone",
      source: zoneSource(zone),
      type: zone.type,
      name: zone.name,
      severity: zoneSeverity(zone.type),
      floorAltitude: zone.floorAltitude,
      ceilingAltitude: zone.ceilingAltitude,
      effectiveStartIso: zone.validFrom,
      effectiveEndIso: zone.validTo,
      summary: zone.authority,
    });
  }

  // NOTAMs — proximity-based + time-window filter.
  const windowStartIso = new Date(windowStartMs).toISOString();
  const windowEndIso = new Date(windowEndMs).toISOString();
  for (const notam of notams) {
    const startMs = Date.parse(notam.effectiveFrom);
    const endMs = Date.parse(notam.effectiveTo);
    // If either date is unparseable we still consider it active.
    const activeAtSomePoint =
      (Number.isNaN(startMs) || startMs <= windowEndMs) &&
      (Number.isNaN(endMs) || endMs >= windowStartMs);
    if (!activeAtSomePoint) continue;

    const hit = samples.some(([lat, lon]) => isNotamNearby(lat, lon, notam));
    if (!hit) continue;
    const key = `faa-notam:${notam.id}`;
    if (intersections.has(key)) continue;
    intersections.set(key, {
      id: notam.id,
      kind: "notam",
      source: "faa-notam",
      type: "notam",
      name: notam.title || notam.id,
      severity: "warning",
      floorAltitude: notam.floorAltitude,
      ceilingAltitude: notam.ceilingAltitude,
      effectiveStartIso: notam.effectiveFrom,
      effectiveEndIso: notam.effectiveTo,
      summary: notam.text?.slice(0, 140),
    });
  }

  // TFRs — geometry + time-window filter.
  for (const tfr of tfrs) {
    const startMs = Date.parse(tfr.validFrom);
    const endMs = Date.parse(tfr.validTo);
    const activeAtSomePoint =
      (Number.isNaN(startMs) || startMs <= windowEndMs) &&
      (Number.isNaN(endMs) || endMs >= windowStartMs);
    if (!activeAtSomePoint) continue;

    const hit = samples.some(([lat, lon]) => isPointInTfr(lat, lon, tfr));
    if (!hit) continue;
    const key = `faa-tfr:${tfr.id}`;
    if (intersections.has(key)) continue;
    intersections.set(key, {
      id: tfr.id,
      kind: "tfr",
      source: "faa-tfr",
      type: "tfr",
      name: tfr.name,
      severity: "error",
      floorAltitude: tfr.floorAltitude,
      ceilingAltitude: tfr.ceilingAltitude,
      effectiveStartIso: tfr.validFrom,
      effectiveEndIso: tfr.validTo,
      summary: tfr.description,
    });
  }

  if (intersections.size === 0) return undefined;

  // Sort by severity then name so the Overview card renders errors first.
  const sevRank: Record<AirspaceIntersection["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const sorted = Array.from(intersections.values()).sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    return a.name.localeCompare(b.name);
  });

  return {
    computedAt: new Date().toISOString(),
    pathSampleCount: samples.length,
    windowStartIso,
    windowEndIso,
    bbox: { south: bbox.south, north: bbox.north, west: bbox.west, east: bbox.east },
    intersections: sorted,
  };
}
