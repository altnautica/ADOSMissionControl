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
import { droneSelection, selectedDroneProtocol } from "./drone-selection";
import { withPlannerHistory } from "@/lib/planner-history-adapter";
import { polygonBounds } from "@/lib/drawing/geo-utils";
import type { FenceElement } from "@/lib/protocol/types";
import {
  nextZoneId,
  flattenToPolygon,
  buildFenceElements,
  elementToZone,
  fenceContentHash,
  writeFenceParams,
  readFenceParams,
} from "@/lib/geofence-elements";
import { useUploadReceiptsStore } from "./upload-receipts-store";

export type FenceType = "circle" | "polygon";
export type BreachAction = "RTL" | "LAND" | "REPORT";

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

/** Outcome of a fence upload or download, carrying the reason on failure so
 *  the calling surface can report it instead of toasting an affirmative. */
export interface FenceTransferResult {
  success: boolean;
  message: string;
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
  /** Reset the breach readout. FENCE_STATUS is latched — the FC stops sending
   *  it once the breach clears, so nothing else ever lowers the alarm. Called
   *  on connection reset and on a selected-drone switch. */
  clearBreachState: () => void;
  // Fence edits below (through clearFence) are operator-facing: each one is a
  // planner undo step.
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

  /** Upload the fence and report what the flight controller acknowledged.
   *  Never resolves `success: true` for an upload the FC did not confirm. */
  uploadFence: () => Promise<FenceTransferResult>;
  downloadFence: () => Promise<FenceTransferResult>;
  clearFence: () => void;

  /** Capture the operator-editable fence state for the coordinated undo timeline. */
  snapshot: () => GeofenceSnapshot;
  /** Restore a previously captured fence state (from undo / redo). */
  restore: (snap: GeofenceSnapshot) => void;
}

export const useGeofenceStore = create<GeofenceStoreState>()(
  persist<GeofenceStoreState, [], [], Partial<GeofenceStoreState>>(
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

  clearBreachState: () => set({ breachStatus: 0, breachCount: 0, breachType: 0 }),
  setEnabled: (enabled) => withPlannerHistory(() => set({ enabled })),
  setFenceType: (fenceType) => withPlannerHistory(() => set({ fenceType })),
  setMaxAltitude: (maxAltitude) => withPlannerHistory(() => set({ maxAltitude })),
  setMinAltitude: (minAltitude) => withPlannerHistory(() => set({ minAltitude })),
  setBreachAction: (breachAction) => withPlannerHistory(() => set({ breachAction })),

  setCircle: (center, radius) =>
    withPlannerHistory(() => set({ circleCenter: center, circleRadius: radius })),

  setPolygonPoints: (polygonPoints) => withPlannerHistory(() => set({ polygonPoints })),

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
    withPlannerHistory(() => set({ fenceType: "polygon", polygonPoints, enabled: true }));
  },

  addZone: (zone) => {
    const id = nextZoneId();
    withPlannerHistory(() => set((s) => ({ zones: [...s.zones, { ...zone, id }] })));
  },

  removeZone: (id) =>
    withPlannerHistory(() => set((s) => ({ zones: s.zones.filter((z) => z.id !== id) }))),

  updateZonePolygon: (id, points) =>
    withPlannerHistory(() =>
      set((s) => ({
        zones: s.zones.map((z) => (z.id === id ? { ...z, polygonPoints: points } : z)),
      })),
    ),

  updateZoneCircle: (id, center, radius) =>
    withPlannerHistory(() =>
      set((s) => ({
        zones: s.zones.map((z) =>
          z.id === id ? { ...z, circleCenter: center, circleRadius: radius } : z,
        ),
      })),
    ),

  toggleZoneRole: (id) =>
    withPlannerHistory(() =>
      set((s) => ({
        zones: s.zones.map((z) =>
          z.id === id
            ? { ...z, role: z.role === "inclusion" ? "exclusion" : "inclusion" }
            : z,
        ),
      })),
    ),

  uploadFence: async () => {
    const protocol = selectedDroneProtocol();
    if (!protocol) {
      return { success: false, message: "No flight controller connected" };
    }
    // The mission-type fence protocol carries every element (the primary
    // boundary plus each inclusion/exclusion zone) and is what ArduPilot and
    // PX4 both implement, so it wins whenever the adapter offers it. The
    // point-list path is a single boundary polygon only.
    const useMissionFence = typeof protocol.uploadFenceMission === "function";
    if (!useMissionFence && !protocol.uploadFence) {
      return { success: false, message: "This flight controller does not support fence upload" };
    }

    const snap = get().snapshot();
    const { fenceType, polygonPoints, circleCenter, circleRadius, zones } = snap;
    const droneId = droneSelection().selectedDroneId;
    const firmware = protocol.getVehicleInfo()?.firmwareType;

    // Build the payload before flipping upload state so an empty fence is a no-op.
    let elements: FenceElement[] = [];
    let points: Array<{ lat: number; lon: number }> = [];
    if (useMissionFence) {
      elements = buildFenceElements(fenceType, polygonPoints, circleCenter, circleRadius, zones);
      if (elements.length === 0) {
        return { success: false, message: "Nothing to upload — the fence is empty" };
      }
    } else {
      // A zone the transfer cannot carry must stop the upload: reporting the
      // boundary as uploaded would vouch for exclusion zones the FC never got.
      if (zones.length > 0) {
        return {
          success: false,
          message:
            "This flight controller's fence protocol carries one boundary only; remove the inclusion and exclusion zones to upload",
        };
      }
      points = flattenToPolygon(fenceType, polygonPoints, circleCenter, circleRadius);
      if (points.length < 3) {
        return { success: false, message: "A fence needs at least 3 boundary points" };
      }
    }

    const isPx4 = firmware === "px4";
    const receipts = useUploadReceiptsStore.getState();
    set({ uploadState: "uploading" });
    let outcome: FenceTransferResult;
    try {
      const result = useMissionFence
        ? await protocol.uploadFenceMission!(elements)
        : await protocol.uploadFence!(points);
      // The geometry alone enforces nothing: the enable flag, fence type,
      // altitude ceiling and breach action are parameters. A fence the FC
      // holds but does not enforce is not "uploaded", so any failed write
      // fails the upload.
      outcome = result.success
        ? await writeFenceParams(protocol, isPx4, snap)
        : { success: false, message: result.message };
      if (outcome.success) outcome = { success: true, message: result.message };
    } catch (err) {
      outcome = { success: false, message: err instanceof Error ? err.message : String(err) };
    }
    set({ uploadState: outcome.success ? "uploaded" : "error" });
    if (droneId) {
      if (outcome.success) {
        receipts.record("fence", { droneId, contentHash: fenceContentHash(snap), at: Date.now() });
      } else {
        // A partial transfer leaves the FC's fence unknown.
        receipts.clearKindForDrone("fence", droneId);
      }
    }
    return outcome;
  },

  downloadFence: async () => {
    const protocol = selectedDroneProtocol();
    if (!protocol) {
      return { success: false, message: "No flight controller connected" };
    }
    const useMissionFence = typeof protocol.downloadFenceMission === "function";
    if (!useMissionFence && !protocol.downloadFence) {
      return { success: false, message: "This flight controller does not support fence download" };
    }

    const firmware = protocol.getVehicleInfo()?.firmwareType;
    const isPx4 = firmware === "px4";
    const droneId = droneSelection().selectedDroneId;
    const noFence = { success: true, message: "No fence stored on the flight controller" };

    set({ downloadState: "downloading" });
    try {
      // Read everything before touching local state, so a failed read never
      // leaves a half-replaced fence.
      let geometry: Partial<GeofenceSnapshot>;
      let message: string;
      if (useMissionFence) {
        const elements = await protocol.downloadFenceMission!();
        if (elements.length === 0) {
          set({ downloadState: "downloaded" });
          return noFence;
        }
        // The first inclusion element (else the first element) is the primary
        // fence; every remaining element becomes an inclusion/exclusion zone.
        const firstInclusion = elements.findIndex((e) => e.role === "inclusion");
        const primaryIdx = firstInclusion >= 0 ? firstInclusion : 0;
        const primary = elements[primaryIdx];
        const zones = elements.filter((_, i) => i !== primaryIdx).map(elementToZone);
        geometry =
          primary.kind === "polygon"
            ? {
                fenceType: "polygon",
                polygonPoints: primary.vertices.map((v) => [v.lat, v.lon] as [number, number]),
                zones,
              }
            : {
                fenceType: "circle",
                circleCenter: [primary.center.lat, primary.center.lon],
                circleRadius: primary.radius,
                zones,
              };
        message = `Loaded ${elements.length} fence elements`;
      } else {
        const points = await protocol.downloadFence!();
        if (points.length < 3) {
          set({ downloadState: "downloaded" });
          return noFence;
        }
        // The point-list protocol holds one boundary and no zones, so any
        // local zone is not on the FC and must not survive into what the
        // planner now presents as the FC's fence.
        geometry = {
          fenceType: "polygon",
          polygonPoints: points.map((p) => [p.lat, p.lon] as [number, number]),
          zones: [],
        };
        message = `Loaded ${points.length} fence points`;
      }
      const params = await readFenceParams(protocol, isPx4);
      // Replacing the operator's fence with the FC's is an edit like any
      // other: one undo step brings the local fence back.
      withPlannerHistory(() =>
        set({
          ...geometry,
          enabled: params.enabled,
          maxAltitude: params.maxAltitude,
          minAltitude: params.minAltitude,
          ...(params.breachAction ? { breachAction: params.breachAction } : {}),
        }),
      );
      set({ downloadState: "downloaded" });
      // The planner now shows what the FC holds, unless its breach action has
      // no planner equivalent (the local action was kept, so they differ).
      if (droneId && params.breachAction) {
        useUploadReceiptsStore.getState().record("fence", {
          droneId,
          contentHash: fenceContentHash(get().snapshot()),
          at: Date.now(),
        });
      }
      return params.breachAction
        ? { success: true, message }
        : { success: true, message: `${message}; the FC's breach action has no planner equivalent` };
    } catch (err) {
      set({ downloadState: "error" });
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },

  clearFence: () =>
    withPlannerHistory(() =>
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
    ),

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
        return state as Partial<GeofenceStoreState>;
      },
    },
  ),
);
