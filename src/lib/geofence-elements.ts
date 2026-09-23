/**
 * @module geofence-elements
 * @description Pure fence conversions (planner geometry ⇄ FC fence payloads),
 * the fence content hash an upload receipt records, and the fence parameters
 * written alongside the geometry so the flight controller actually enforces
 * what the planner shows (enable, type, altitude ceiling, breach action).
 * @license GPL-3.0-only
 */

import type { DroneProtocol, FenceElement } from "@/lib/protocol/types";
import type {
  BreachAction,
  FenceType,
  FenceZone,
  GeofenceSnapshot,
} from "@/stores/geofence-store";
import { contentHash } from "@/stores/upload-receipts-store";

/** ArduPilot FENCE_TYPE bitmask */
export const FENCE_TYPE_BITS = {
  ALT_MAX: 1 << 0,
  CIRCLE: 1 << 1,
  POLYGON: 1 << 2,
} as const;

/**
 * ArduPilot `FENCE_ACTION` values for the breach responses the planner exposes.
 * (0 = report only, 1 = RTL or land, 2 = always land.)
 */
const AP_FENCE_ACTION: Record<BreachAction, number> = { REPORT: 0, RTL: 1, LAND: 2 };

/** PX4 `GF_ACTION` values (0 none, 1 warning, 2 hold, 3 return, 4 terminate, 5 land). */
const PX4_GF_ACTION: Record<BreachAction, number> = { REPORT: 1, RTL: 3, LAND: 5 };

let zoneIdCounter = 0;
export function nextZoneId(): string {
  return `zone-${++zoneIdCounter}`;
}

/** Approximate a circle as a 16-vertex polygon (legacy FENCE_POINT path). */
function circleToPolygon(
  center: [number, number],
  radiusMeters: number,
): Array<{ lat: number; lon: number }> {
  const pts: Array<{ lat: number; lon: number }> = [];
  const cosLat = Math.cos((center[0] * Math.PI) / 180);
  const lonScale = 111320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat);
  for (let i = 0; i < 16; i++) {
    const angle = (i * 2 * Math.PI) / 16;
    const dLat = (radiusMeters / 111320) * Math.cos(angle);
    const dLon = (radiusMeters / lonScale) * Math.sin(angle);
    pts.push({ lat: center[0] + dLat, lon: center[1] + dLon });
  }
  return pts;
}

/**
 * Flatten the active fence to a single inclusion polygon for the legacy
 * FENCE_POINT path (ArduPilot). A circle becomes a 16-vertex polygon.
 */
export function flattenToPolygon(
  fenceType: FenceType,
  polygonPoints: [number, number][],
  circleCenter: [number, number] | null,
  circleRadius: number,
): Array<{ lat: number; lon: number }> {
  if (fenceType === "polygon") {
    return polygonPoints.map(([lat, lon]) => ({ lat, lon }));
  }
  if (!circleCenter) return [];
  return circleToPolygon(circleCenter, circleRadius);
}

/**
 * Build the fence model for the mission-type-fence path (PX4). The primary
 * fence is an inclusion zone (stay inside); each additional zone keeps its own
 * inclusion/exclusion role. Circles stay native (no polygon approximation).
 */
export function buildFenceElements(
  fenceType: FenceType,
  polygonPoints: [number, number][],
  circleCenter: [number, number] | null,
  circleRadius: number,
  zones: FenceZone[],
): FenceElement[] {
  const elements: FenceElement[] = [];
  if (fenceType === "polygon") {
    if (polygonPoints.length >= 3) {
      elements.push({
        kind: "polygon",
        role: "inclusion",
        vertices: polygonPoints.map(([lat, lon]) => ({ lat, lon })),
      });
    }
  } else if (circleCenter) {
    elements.push({
      kind: "circle",
      role: "inclusion",
      center: { lat: circleCenter[0], lon: circleCenter[1] },
      radius: circleRadius,
    });
  }
  for (const z of zones) {
    if (z.type === "polygon") {
      if (z.polygonPoints.length >= 3) {
        elements.push({
          kind: "polygon",
          role: z.role,
          vertices: z.polygonPoints.map(([lat, lon]) => ({ lat, lon })),
        });
      }
    } else if (z.circleCenter) {
      elements.push({
        kind: "circle",
        role: z.role,
        center: { lat: z.circleCenter[0], lon: z.circleCenter[1] },
        radius: z.circleRadius,
      });
    }
  }
  return elements;
}

/** Convert a downloaded fence element into a store zone. */
export function elementToZone(el: FenceElement): FenceZone {
  if (el.kind === "polygon") {
    return {
      id: nextZoneId(),
      role: el.role,
      type: "polygon",
      polygonPoints: el.vertices.map((v) => [v.lat, v.lon] as [number, number]),
      circleCenter: null,
      circleRadius: 0,
    };
  }
  return {
    id: nextZoneId(),
    role: el.role,
    type: "circle",
    polygonPoints: [],
    circleCenter: [el.center.lat, el.center.lon],
    circleRadius: el.radius,
  };
}

/**
 * Hash of the operator-editable fence content. Zone ids are local handles, not
 * content, so they are left out.
 */
export function fenceContentHash(s: GeofenceSnapshot): string {
  return contentHash([
    s.enabled,
    s.fenceType,
    s.maxAltitude,
    s.minAltitude,
    s.breachAction,
    s.circleCenter,
    s.circleRadius,
    s.polygonPoints,
    s.zones.map((z) => [z.role, z.type, z.polygonPoints, z.circleCenter, z.circleRadius]),
  ]);
}

/** Outcome of the fence parameter writes; `message` names a failed parameter. */
export interface FenceParamResult {
  success: boolean;
  message: string;
}

async function writeParam(
  protocol: DroneProtocol,
  name: string,
  value: number,
): Promise<string | null> {
  try {
    const r = await protocol.setParameter(name, value);
    return r.success ? null : `${name} write failed: ${r.message}`;
  } catch (err) {
    return `${name} write failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Write the fence parameters that make the FC enforce the uploaded geometry.
 * ArduPilot: FENCE_ACTION, FENCE_TYPE (polygon, plus the altitude ceiling when
 * one is set), FENCE_ALT_MAX, then FENCE_ENABLE last so the fence only turns on
 * once it is configured. PX4: GF_MAX_VER_DIST, then GF_ACTION (0 = disabled).
 * Stops at the first failed write.
 */
export async function writeFenceParams(
  protocol: DroneProtocol,
  isPx4: boolean,
  s: Pick<GeofenceSnapshot, "enabled" | "maxAltitude" | "breachAction">,
): Promise<FenceParamResult> {
  const writes: Array<[string, number]> = isPx4
    ? [
        ["GF_MAX_VER_DIST", s.maxAltitude],
        ["GF_ACTION", s.enabled ? PX4_GF_ACTION[s.breachAction] : 0],
      ]
    : [
        ["FENCE_ACTION", AP_FENCE_ACTION[s.breachAction]],
        ["FENCE_TYPE", FENCE_TYPE_BITS.POLYGON | (s.maxAltitude > 0 ? FENCE_TYPE_BITS.ALT_MAX : 0)],
        ...(s.maxAltitude > 0 ? [["FENCE_ALT_MAX", s.maxAltitude] as [string, number]] : []),
        ["FENCE_ENABLE", s.enabled ? 1 : 0],
      ];
  for (const [name, value] of writes) {
    const failure = await writeParam(protocol, name, value);
    if (failure) return { success: false, message: failure };
  }
  return { success: true, message: "Fence parameters written" };
}

/** Fence parameters read back from the FC, in planner terms. */
export interface FenceParams {
  enabled: boolean;
  maxAltitude: number;
  /** `undefined` when the FC's breach action has no planner equivalent. */
  breachAction: BreachAction | undefined;
}

function actionFromValue(table: Record<BreachAction, number>, value: number): BreachAction | undefined {
  return (Object.keys(table) as BreachAction[]).find((k) => table[k] === value);
}

/** Read the fence parameters back. Rejects when any read fails. */
export async function readFenceParams(protocol: DroneProtocol, isPx4: boolean): Promise<FenceParams> {
  if (isPx4) {
    const action = (await protocol.getParameter("GF_ACTION")).value;
    const maxAltitude = (await protocol.getParameter("GF_MAX_VER_DIST")).value;
    return {
      enabled: action !== 0,
      maxAltitude,
      breachAction: action === 0 ? undefined : actionFromValue(PX4_GF_ACTION, action),
    };
  }
  const enabled = (await protocol.getParameter("FENCE_ENABLE")).value !== 0;
  const maxAltitude = (await protocol.getParameter("FENCE_ALT_MAX")).value;
  const action = (await protocol.getParameter("FENCE_ACTION")).value;
  return { enabled, maxAltitude, breachAction: actionFromValue(AP_FENCE_ACTION, action) };
}
