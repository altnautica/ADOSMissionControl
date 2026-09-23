/**
 * The geofence and rally-point blocks of a QGroundControl `.plan` file: the
 * serializer the `.plan` export writes and the parser the `.plan` import reads.
 *
 * @module mission/qgc-plan-extras
 * @license GPL-3.0-only
 */

import type { GeofenceSnapshot, FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";

interface QGCFenceCircleEntry {
  inclusion: boolean;
  version: 1;
  circle: { center: [number, number]; radius: number };
}

interface QGCFencePolygonEntry {
  inclusion: boolean;
  version: 1;
  polygon: Array<[number, number]>;
}

/** The `.plan` geoFence block as read from a file (every field optional). */
export interface QGCGeoFence {
  circles?: Array<{ inclusion?: boolean; circle?: { center?: [number, number]; radius?: number } }>;
  polygons?: Array<{ inclusion?: boolean; polygon?: Array<[number, number]> }>;
}

/** The `.plan` rallyPoints block as read from a file. */
export interface QGCRallyPoints {
  points?: Array<[number, number, number]>;
}

/** Serialize the operator geofence into the .plan geoFence block. */
export function geofenceToQGC(snapshot: GeofenceSnapshot | undefined): {
  circles: QGCFenceCircleEntry[];
  polygons: QGCFencePolygonEntry[];
  version: 2;
} {
  const circles: QGCFenceCircleEntry[] = [];
  const polygons: QGCFencePolygonEntry[] = [];

  if (snapshot) {
    // Multi-zone inclusion / exclusion fences.
    for (const z of snapshot.zones) {
      const inclusion = z.role === "inclusion";
      if (z.type === "circle" && z.circleCenter) {
        circles.push({
          inclusion,
          version: 1,
          circle: { center: [z.circleCenter[0], z.circleCenter[1]], radius: z.circleRadius },
        });
      } else if (z.type === "polygon" && z.polygonPoints.length >= 3) {
        polygons.push({
          inclusion,
          version: 1,
          polygon: z.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
        });
      }
    }

    // Legacy single top-level fence (inclusion by definition — must stay inside).
    if (snapshot.enabled) {
      if (snapshot.fenceType === "circle" && snapshot.circleCenter) {
        circles.push({
          inclusion: true,
          version: 1,
          circle: {
            center: [snapshot.circleCenter[0], snapshot.circleCenter[1]],
            radius: snapshot.circleRadius,
          },
        });
      } else if (snapshot.fenceType === "polygon" && snapshot.polygonPoints.length >= 3) {
        polygons.push({
          inclusion: true,
          version: 1,
          polygon: snapshot.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
        });
      }
    }
  }

  return { circles, polygons, version: 2 };
}

/** Serialize rally points into the .plan rallyPoints block ([lat, lon, alt] triples). */
export function rallyToQGC(rally: RallyPoint[] | undefined): {
  points: Array<[number, number, number]>;
  version: 2;
} {
  const points: Array<[number, number, number]> = (rally ?? []).map((p) => [p.lat, p.lon, p.alt]);
  return { points, version: 2 };
}

let importZoneCounter = 0;
function nextImportZoneId(): string {
  return `fence-import-${++importZoneCounter}`;
}

let importRallyCounter = 0;
function nextImportRallyId(): string {
  return `rally-import-${++importRallyCounter}`;
}

/** Parse the .plan geoFence block into a GeofenceSnapshot (inclusion / exclusion zones). */
export function parseQGCGeoFence(geoFence: QGCGeoFence | undefined): GeofenceSnapshot | undefined {
  if (!geoFence) return undefined;

  const zones: FenceZone[] = [];

  for (const c of geoFence.circles ?? []) {
    const center = c?.circle?.center;
    const radius = c?.circle?.radius;
    if (
      Array.isArray(center) && center.length >= 2 &&
      Number.isFinite(center[0]) && Number.isFinite(center[1]) &&
      typeof radius === "number" && Number.isFinite(radius)
    ) {
      zones.push({
        id: nextImportZoneId(),
        role: c.inclusion === false ? "exclusion" : "inclusion",
        type: "circle",
        polygonPoints: [],
        circleCenter: [center[0], center[1]],
        circleRadius: radius,
      });
    }
  }

  for (const p of geoFence.polygons ?? []) {
    const poly = p?.polygon;
    if (Array.isArray(poly)) {
      const points = poly
        .filter((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
        .map((pt) => [pt[0], pt[1]] as [number, number]);
      if (points.length >= 3) {
        zones.push({
          id: nextImportZoneId(),
          role: p.inclusion === false ? "exclusion" : "inclusion",
          type: "polygon",
          polygonPoints: points,
          circleCenter: null,
          circleRadius: 0,
        });
      }
    }
  }

  if (zones.length === 0) return undefined;

  return {
    enabled: true,
    fenceType: zones[0].type,
    maxAltitude: 120,
    minAltitude: 0,
    breachAction: "RTL",
    circleCenter: null,
    circleRadius: 200,
    polygonPoints: [],
    zones,
  };
}

/** Parse the .plan rallyPoints block into RallyPoint[]. */
export function parseQGCRally(rallyPoints: QGCRallyPoints | undefined): RallyPoint[] | undefined {
  const raw = rallyPoints?.points;
  if (!Array.isArray(raw)) return undefined;

  const points: RallyPoint[] = [];
  for (const pt of raw) {
    if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      const alt = pt[2];
      points.push({
        id: nextImportRallyId(),
        lat: pt[0],
        lon: pt[1],
        alt: typeof alt === "number" && Number.isFinite(alt) ? alt : 0,
      });
    }
  }

  return points.length > 0 ? points : undefined;
}
