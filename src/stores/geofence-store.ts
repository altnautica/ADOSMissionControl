/**
 * @module geofence-store
 * @description Zustand store for geofence state. Manages fence type, altitude,
 * breach action, polygon/circle geometry, inclusion/exclusion zones,
 * and protocol upload/download.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage";
import { useDroneManager } from "./drone-manager";
import { polygonBounds } from "@/lib/drawing/geo-utils";
import type { FenceElement } from "@/lib/protocol/types";

export type FenceType = "circle" | "polygon";
export type BreachAction = "RTL" | "LAND" | "REPORT";

/**
 * ArduPilot `FENCE_ACTION` values for the breach responses the planner exposes.
 * (0 = report only, 1 = RTL or land, 2 = always land.)
 */
const FENCE_ACTION_VALUE: Record<BreachAction, number> = {
  REPORT: 0,
  RTL: 1,
  LAND: 2,
};

/** Fence zone role: inclusion = must stay inside, exclusion = must stay outside */
export type FenceZoneRole = "inclusion" | "exclusion";

export interface FenceZone {
  id: string;
  role: FenceZoneRole;
  type: FenceType;
  /** Polygon points [lat, lon] for polygon zones */
  polygonPoints: [number, number][];
  /** Center for circle zones */
  circleCenter: [number, number] | null;
  /** Radius for circle zones (meters) */
  circleRadius: number;
}

/** ArduPilot FENCE_TYPE bitmask */
export const FENCE_TYPE_BITS = {
  ALT_MAX: 1 << 0,
  CIRCLE: 1 << 1,
  POLYGON: 1 << 2,
} as const;

/**
 * Immutable snapshot of the operator-editable geofence state for the
 * coordinated planner undo timeline. Live FENCE_STATUS telemetry (breach
 * fields) and async upload/download state are intentionally excluded — they are
 * driven by the FC, not by operator edits, so undo must not roll them back.
 */
export interface GeofenceSnapshot {
  enabled: boolean;
  fenceType: FenceType;
  maxAltitude: number;
  minAltitude: number;
  breachAction: BreachAction;
  circleCenter: [number, number] | null;
  circleRadius: number;
  polygonPoints: [number, number][];
  zones: FenceZone[];
}

interface GeofenceStoreState {
  enabled: boolean;
  fenceType: FenceType;
  maxAltitude: number;
  minAltitude: number;
  breachAction: BreachAction;
  circleCenter: [number, number] | null;
  circleRadius: number;
  polygonPoints: [number, number][];
  uploadState: "idle" | "uploading" | "uploaded" | "error";
  downloadState: "idle" | "downloading" | "downloaded" | "error";

  /** Inclusion/exclusion zones for multi-zone fence support */
  zones: FenceZone[];

  // Live breach state from FENCE_STATUS (msg 162)
  breachStatus: number;  // 0=no breach, 1=breach active
  breachCount: number;   // cumulative breach count
  breachType: number;    // FENCE_BREACH enum (0=none, 1=minAlt, 2=maxAlt, 3=boundary)

  updateBreachState: (breachStatus: number, breachCount: number, breachType: number) => void;
  setEnabled: (enabled: boolean) => void;
  setFenceType: (type: FenceType) => void;
  setMaxAltitude: (alt: number) => void;
  setMinAltitude: (alt: number) => void;
  setBreachAction: (action: BreachAction) => void;
  setCircle: (center: [number, number], radius: number) => void;
  setPolygonPoints: (points: [number, number][]) => void;

  /**
   * Build an inclusion polygon fence around a set of boundary points: the
   * bounding box of the points expanded outward by `bufferMeters`, committed as
   * the active polygon fence (type polygon, enabled). Powers the one-click
   * auto-fence around the current mission/pattern boundary. A non-positive
   * buffer is clamped to zero; an empty point list is a no-op.
   */
  generateFromBoundary: (points: [number, number][], bufferMeters: number) => void;

  /** Add a new inclusion/exclusion zone */
  addZone: (zone: Omit<FenceZone, "id">) => void;
  /** Remove a zone by ID */
  removeZone: (id: string) => void;
  /** Update a zone's polygon points (from map drag) */
  updateZonePolygon: (id: string, points: [number, number][]) => void;
  /** Update a zone's circle (from map drag) */
  updateZoneCircle: (id: string, center: [number, number], radius: number) => void;
  /** Toggle zone role between inclusion/exclusion */
  toggleZoneRole: (id: string) => void;

  uploadFence: () => Promise<void>;
  downloadFence: () => Promise<void>;
  clearFence: () => void;

  /** Capture the operator-editable fence state for the coordinated undo timeline. */
  snapshot: () => GeofenceSnapshot;
  /** Restore a previously captured fence state (from undo / redo). */
  restore: (snap: GeofenceSnapshot) => void;
}

let zoneIdCounter = 0;
function nextZoneId(): string {
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
function flattenToPolygon(
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
function buildFenceElements(
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
function elementToZone(el: FenceElement): FenceZone {
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

export const useGeofenceStore = create<GeofenceStoreState>()(
  persist(
    (set, get) => ({
  enabled: false,
  fenceType: "circle",
  maxAltitude: 120,
  minAltitude: 0,
  breachAction: "RTL",
  circleCenter: null,
  circleRadius: 200,
  polygonPoints: [],
  uploadState: "idle",
  downloadState: "idle",
  zones: [],

  breachStatus: 0,
  breachCount: 0,
  breachType: 0,

  updateBreachState: (breachStatus, breachCount, breachType) =>
    set({ breachStatus, breachCount, breachType }),
  setEnabled: (enabled) => set({ enabled }),
  setFenceType: (fenceType) => set({ fenceType }),
  setMaxAltitude: (maxAltitude) => set({ maxAltitude }),
  setMinAltitude: (minAltitude) => set({ minAltitude }),
  setBreachAction: (breachAction) => set({ breachAction }),

  setCircle: (center, radius) =>
    set({ circleCenter: center, circleRadius: radius }),

  setPolygonPoints: (polygonPoints) => set({ polygonPoints }),

  generateFromBoundary: (points, bufferMeters) => {
    if (points.length === 0) return;
    const buffer = Number.isFinite(bufferMeters) && bufferMeters > 0 ? bufferMeters : 0;
    const { minLat, maxLat, minLon, maxLon } = polygonBounds(points);
    // meters -> degrees, matching the circle-geofence conversion below
    // (~111320 m per degree of latitude; longitude scales with cos(latitude)).
    const dLat = buffer / 111320;
    const meanLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((meanLat * Math.PI) / 180);
    const dLon = buffer / (111320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));
    const polygonPoints: [number, number][] = [
      [minLat - dLat, minLon - dLon],
      [minLat - dLat, maxLon + dLon],
      [maxLat + dLat, maxLon + dLon],
      [maxLat + dLat, minLon - dLon],
    ];
    set({ fenceType: "polygon", polygonPoints, enabled: true });
  },

  addZone: (zone) => {
    const id = nextZoneId();
    set((s) => ({ zones: [...s.zones, { ...zone, id }] }));
  },

  removeZone: (id) => {
    set((s) => ({ zones: s.zones.filter((z) => z.id !== id) }));
  },

  updateZonePolygon: (id, points) => {
    set((s) => ({
      zones: s.zones.map((z) => (z.id === id ? { ...z, polygonPoints: points } : z)),
    }));
  },

  updateZoneCircle: (id, center, radius) => {
    set((s) => ({
      zones: s.zones.map((z) =>
        z.id === id ? { ...z, circleCenter: center, circleRadius: radius } : z,
      ),
    }));
  },

  toggleZoneRole: (id) => {
    set((s) => ({
      zones: s.zones.map((z) =>
        z.id === id
          ? { ...z, role: z.role === "inclusion" ? "exclusion" : "inclusion" }
          : z,
      ),
    }));
  },

  uploadFence: async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol?.uploadFence) return;

    const { fenceType, polygonPoints, circleCenter, circleRadius, breachAction, zones } = get();
    const firmware = protocol.getVehicleInfo()?.firmwareType;
    // PX4 stores the geofence as a mission plan (mission_type = fence). ArduPilot
    // and other firmwares use the legacy FENCE_POINT protocol. Branch here so a
    // PX4 upload is no longer a silent no-op against the legacy path.
    const useMissionFence =
      firmware === "px4" && typeof protocol.uploadFenceMission === "function";

    // Build the payload before flipping upload state so an empty fence is a no-op.
    let elements: FenceElement[] = [];
    let points: Array<{ lat: number; lon: number }> = [];
    if (useMissionFence) {
      elements = buildFenceElements(fenceType, polygonPoints, circleCenter, circleRadius, zones);
      if (elements.length === 0) return;
    } else {
      points = flattenToPolygon(fenceType, polygonPoints, circleCenter, circleRadius);
      if (points.length < 3) return;
    }

    set({ uploadState: "uploading" });
    try {
      const result = useMissionFence
        ? await protocol.uploadFenceMission!(elements)
        : await protocol.uploadFence(points);
      set({ uploadState: result.success ? "uploaded" : "error" });
      // Best-effort: write the ArduPilot breach action alongside the geometry so
      // the FC enforces the operator's chosen response. Advisory: a failed or
      // unsupported param write never flips the committed geometry upload to an
      // error. FENCE_ACTION is an ArduPilot parameter, so it is only written on
      // the legacy path (PX4 uses a different breach-action parameter and enum).
      if (result.success && !useMissionFence) {
        try {
          await protocol.setParameter("FENCE_ACTION", FENCE_ACTION_VALUE[breachAction]);
        } catch {
          // FENCE_ACTION write is advisory; ignore.
        }
      }
    } catch {
      set({ uploadState: "error" });
    }
  },

  downloadFence: async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol?.downloadFence) return;

    const firmware = protocol.getVehicleInfo()?.firmwareType;
    const useMissionFence =
      firmware === "px4" && typeof protocol.downloadFenceMission === "function";

    set({ downloadState: "downloading" });
    try {
      if (useMissionFence) {
        const elements = await protocol.downloadFenceMission!();
        if (elements.length === 0) {
          set({ downloadState: "downloaded" });
          return;
        }
        // The first inclusion element (else the first element) is the primary
        // fence; every remaining element becomes an inclusion/exclusion zone.
        const firstInclusion = elements.findIndex((e) => e.role === "inclusion");
        const primaryIdx = firstInclusion >= 0 ? firstInclusion : 0;
        const primary = elements[primaryIdx];
        const rest = elements.filter((_, i) => i !== primaryIdx);
        const zones = rest.map(elementToZone);
        if (primary.kind === "polygon") {
          set({
            fenceType: "polygon",
            polygonPoints: primary.vertices.map((v) => [v.lat, v.lon] as [number, number]),
            zones,
            enabled: true,
            downloadState: "downloaded",
          });
        } else {
          set({
            fenceType: "circle",
            circleCenter: [primary.center.lat, primary.center.lon],
            circleRadius: primary.radius,
            zones,
            enabled: true,
            downloadState: "downloaded",
          });
        }
        return;
      }

      const points = await protocol.downloadFence();
      if (points.length >= 3) {
        set({
          fenceType: "polygon",
          polygonPoints: points.map((p) => [p.lat, p.lon] as [number, number]),
          enabled: true,
          downloadState: "downloaded",
        });
      } else {
        set({ downloadState: "downloaded" });
      }
    } catch {
      set({ downloadState: "error" });
    }
  },

  clearFence: () =>
    set({
      enabled: false,
      circleCenter: null,
      circleRadius: 200,
      polygonPoints: [],
      zones: [],
      uploadState: "idle",
      downloadState: "idle",
      breachStatus: 0,
      breachCount: 0,
      breachType: 0,
    }),

  snapshot: () => {
    const s = get();
    return {
      enabled: s.enabled,
      fenceType: s.fenceType,
      maxAltitude: s.maxAltitude,
      minAltitude: s.minAltitude,
      breachAction: s.breachAction,
      // Deep-copy geometry so a later mutation can never alias a stored snapshot.
      circleCenter: s.circleCenter ? [s.circleCenter[0], s.circleCenter[1]] : null,
      circleRadius: s.circleRadius,
      polygonPoints: s.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
      zones: s.zones.map((z) => ({
        ...z,
        polygonPoints: z.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
        circleCenter: z.circleCenter ? [z.circleCenter[0], z.circleCenter[1]] as [number, number] : null,
      })),
    };
  },

  restore: (snap) =>
    set({
      enabled: snap.enabled,
      fenceType: snap.fenceType,
      maxAltitude: snap.maxAltitude,
      minAltitude: snap.minAltitude,
      breachAction: snap.breachAction,
      circleCenter: snap.circleCenter ? [snap.circleCenter[0], snap.circleCenter[1]] : null,
      circleRadius: snap.circleRadius,
      polygonPoints: snap.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
      zones: snap.zones.map((z) => ({
        ...z,
        polygonPoints: z.polygonPoints.map(([lat, lon]) => [lat, lon] as [number, number]),
        circleCenter: z.circleCenter ? [z.circleCenter[0], z.circleCenter[1]] as [number, number] : null,
      })),
    }),
    }),
    {
      name: "altcmd:geofence-store",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 1,
      // Only the operator-editable fence geometry persists. Live FENCE_STATUS
      // breach fields and async upload/download state are driven by the FC, so
      // restoring them would report a stale breach on a fresh session.
      partialize: (state) => ({
        enabled: state.enabled,
        fenceType: state.fenceType,
        maxAltitude: state.maxAltitude,
        minAltitude: state.minAltitude,
        breachAction: state.breachAction,
        circleCenter: state.circleCenter,
        circleRadius: state.circleRadius,
        polygonPoints: state.polygonPoints,
        zones: state.zones,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 1) {
          // v1 is the first persisted version: nothing was stored before, so a
          // payload claiming v0 predates the schema. Drop its geometry rather
          // than restoring a shape whose vertex order is unknown — a wrong
          // fence uploaded to the FC is a flight-safety defect.
          state.zones = [];
          state.polygonPoints = [];
          state.circleCenter = null;
          state.enabled = false;
        }
        if (!Array.isArray(state.zones)) state.zones = [];
        if (!Array.isArray(state.polygonPoints)) state.polygonPoints = [];
        return state as unknown as GeofenceStoreState;
      },
    },
  ),
);
