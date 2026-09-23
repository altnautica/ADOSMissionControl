import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// The planner stores reach into drone-manager for protocol access; stub it so no
// real protocol is touched. Terrain lookups would hit the network on a waypoint
// add — stub to a no-op resolved promise.
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ getSelectedProtocol: () => null }),
    setState: vi.fn(),
  },
}));
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevation: vi.fn().mockResolvedValue(0),
}));
// planner-store is persisted via indexedDBStorage; stub the backing store so the
// persist middleware has a no-op async storage in the test environment.
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
// mission-io runs an IndexedDB-backed localStorage migration at module load that
// has no backing store in the happy-dom test environment; stub the autosave
// surface the handler imports so the migration never fires.
vi.mock("@/lib/mission-io", () => ({
  clearAutoSave: vi.fn().mockResolvedValue(undefined),
}));

import { usePlannerActions } from "@/app/plan/use-planner-actions";
import { usePlannerStore } from "@/stores/planner-store";
import { usePatternStore } from "@/stores/pattern-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useDrawingStore } from "@/stores/drawing-store";
import type { DrawnPolygon, DrawnCircle } from "@/lib/drawing/types";
import type { DrawingFor } from "@/lib/planner-mode";

/** A square polygon in explicit [lat, lon] vertex order. */
function makePolygon(id = "poly-1"): DrawnPolygon {
  return {
    id,
    vertices: [
      [12.97, 77.59],
      [12.98, 77.59],
      [12.98, 77.6],
      [12.97, 77.6],
    ],
    area: 1000,
  };
}

function makeCircle(id = "circ-1"): DrawnCircle {
  return { id, center: [12.97, 77.59], radius: 150 };
}

/**
 * Build the planner actions hook with no-op deps. handleDrawingComplete reads
 * the live stores directly (mode, pattern, geofence, drawing) and only needs the
 * toast callback off the deps, so the rest are stubs.
 */
function buildActions(activeTool = "polygon") {
  const toast = vi.fn();
  const addWaypoint = vi.fn();
  const { result } = renderHook(() =>
    usePlannerActions({
      waypoints: [],
      activePlanId: "plan-1",
      isDirty: false,
      activeTool,
      defaultAlt: 50,
      defaultSpeed: 5,
      defaultAcceptRadius: 0,
      selectedDroneId: "",
      missionName: "",
      contextMenu: null,
      addWaypoint,
      removeWaypoint: vi.fn(),
      insertWaypoint: vi.fn(),
      clearMission: vi.fn(),
      setWaypoints: vi.fn(),
      downloadMission: vi.fn().mockResolvedValue([]),
      uploadMission: vi.fn().mockResolvedValue(true),
      addRallyPoint: vi.fn(),
      setContextMenu: vi.fn(),
      setSelectedWaypoint: vi.fn(),
      setExpandedWaypoint: vi.fn(),
      setShowClearConfirm: vi.fn(),
      setShowDownloadConfirm: vi.fn(),
      setMissionName: vi.fn(),
      setSelectedDroneId: vi.fn(),
      toast,
    }),
  );
  return {
    handleDrawingComplete: result.current.handleDrawingComplete,
    handleMapClick: result.current.handleMapClick,
    addWaypoint,
    toast,
  };
}

/** Arm the planner into a draw mode with the given destination tag. */
function armDraw(shape: "polygon" | "circle", drawingFor: DrawingFor): void {
  usePlannerStore.getState().setMode({ kind: "draw", shape, drawingFor });
}

function resetStores() {
  useGeofenceStore.getState().clearFence();
  usePatternStore.getState().clear();
  useDrawingStore.getState().clearAll();
  usePlannerStore.getState().setMode({ kind: "select" });
}

describe("handleDrawingComplete routing", () => {
  beforeEach(() => {
    resetStores();
  });

  // ---- Geofence wins over a concurrently-armed pattern (the headline fix) ----
  it("routes a polygon tagged for the geofence even when a pattern is armed", () => {
    // Arm a survey pattern AND tag the draw for the geofence: the explicit tag
    // must win — previously the active pattern silently stole the shape.
    usePatternStore.getState().setPatternType("survey");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "geofence");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    const geo = useGeofenceStore.getState();
    expect(geo.fenceType).toBe("polygon");
    expect(geo.enabled).toBe(true);
    // The [lat, lon] vertex order reaches the fence unchanged.
    expect(geo.polygonPoints).toEqual(poly.vertices);
    // The pattern was NOT fed the boundary.
    expect(usePatternStore.getState().surveyConfig.polygon).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Geofence polygon set"), "success");
  });

  it("routes a circle tagged for the geofence even when an orbit pattern is armed", () => {
    usePatternStore.getState().setPatternType("orbit");
    const circ = makeCircle();
    useDrawingStore.getState().addCircle(circ);
    armDraw("circle", "geofence");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(circ);

    const geo = useGeofenceStore.getState();
    expect(geo.fenceType).toBe("circle");
    expect(geo.enabled).toBe(true);
    // Center [lat, lon] + radius reach the fence unchanged.
    expect(geo.circleCenter).toEqual(circ.center);
    expect(geo.circleRadius).toBe(circ.radius);
    // The orbit pattern was not fed the circle (it still holds its default center).
    expect(usePatternStore.getState().orbitConfig.center).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Geofence circle set"), "success");
  });

  // ---- Free draw + active pattern feeds the pattern (existing flow preserved) ----
  it("feeds an active survey pattern when a free-tagged polygon is drawn", () => {
    usePatternStore.getState().setPatternType("survey");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    // The survey config receives the EXACT vertices in [lat, lon] order.
    expect(usePatternStore.getState().surveyConfig.polygon).toEqual(poly.vertices);
    // The fence is untouched.
    expect(useGeofenceStore.getState().enabled).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Survey area set"), "success");
  });

  it("feeds an active structureScan pattern when a free-tagged polygon is drawn", () => {
    usePatternStore.getState().setPatternType("structureScan");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    expect(usePatternStore.getState().structureScanConfig.structurePolygon).toEqual(poly.vertices);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Structure boundary set"), "success");
  });

  it("feeds an active corridor pattern when a free-tagged polygon is drawn", () => {
    usePatternStore.getState().setPatternType("corridor");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    expect(usePatternStore.getState().corridorConfig.pathPoints).toEqual(poly.vertices);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Corridor path set"), "success");
  });

  it("feeds an active orbit pattern when a free-tagged circle is drawn", () => {
    usePatternStore.getState().setPatternType("orbit");
    const circ = makeCircle();
    useDrawingStore.getState().addCircle(circ);
    armDraw("circle", "free");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(circ);

    expect(usePatternStore.getState().orbitConfig.center).toEqual(circ.center);
    expect(usePatternStore.getState().orbitConfig.radius).toBe(circ.radius);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Orbit area set"), "success");
  });

  // ---- Free draw + no pattern is a plain annotation ----
  it("treats a free-tagged polygon with no active pattern as a plain drawn shape", () => {
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    expect(useGeofenceStore.getState().enabled).toBe(false);
    expect(usePatternStore.getState().surveyConfig.polygon).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Polygon drawn"), "success");
  });

  it("treats a free-tagged circle with no active pattern as a plain drawn shape", () => {
    const circ = makeCircle();
    useDrawingStore.getState().addCircle(circ);
    armDraw("circle", "free");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(circ);

    expect(useGeofenceStore.getState().enabled).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Circle drawn"), "success");
  });

  // ---- The consumed raw shape is dropped only when routed to the geofence ----
  it("removes the raw drawn polygon after routing it to the geofence", () => {
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    expect(useDrawingStore.getState().polygons).toHaveLength(1);
    armDraw("polygon", "geofence");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(poly);

    // The fence now owns the geometry; the raw shape is gone so it is not painted twice.
    expect(useDrawingStore.getState().polygons).toHaveLength(0);
  });

  it("removes the raw drawn circle after routing it to the geofence", () => {
    const circ = makeCircle();
    useDrawingStore.getState().addCircle(circ);
    expect(useDrawingStore.getState().circles).toHaveLength(1);
    armDraw("circle", "geofence");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(circ);

    expect(useDrawingStore.getState().circles).toHaveLength(0);
  });

  // Once a shape is routed to a pattern its geometry lives in the pattern config
  // (and renders from the pattern boundary overlay), so the raw drawn shape is
  // dropped to avoid painting the ring twice. The generator reads the config, not
  // the drawn shape.
  it("removes the raw drawn polygon after routing it to a survey pattern", () => {
    usePatternStore.getState().setPatternType("survey");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    expect(useDrawingStore.getState().polygons).toHaveLength(1);
    armDraw("polygon", "free");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(poly);

    expect(usePatternStore.getState().surveyConfig.polygon).toEqual(poly.vertices);
    expect(useDrawingStore.getState().polygons).toHaveLength(0);
  });

  it("removes the raw drawn polygon after routing it to a structureScan pattern", () => {
    usePatternStore.getState().setPatternType("structureScan");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(poly);

    expect(usePatternStore.getState().structureScanConfig.structurePolygon).toEqual(poly.vertices);
    expect(useDrawingStore.getState().polygons).toHaveLength(0);
  });

  it("removes the raw drawn polygon after routing it to a corridor pattern", () => {
    usePatternStore.getState().setPatternType("corridor");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(poly);

    expect(usePatternStore.getState().corridorConfig.pathPoints).toEqual(poly.vertices);
    expect(useDrawingStore.getState().polygons).toHaveLength(0);
  });

  it("removes the raw drawn circle after routing it to an orbit pattern", () => {
    usePatternStore.getState().setPatternType("orbit");
    const circ = makeCircle();
    useDrawingStore.getState().addCircle(circ);
    expect(useDrawingStore.getState().circles).toHaveLength(1);
    armDraw("circle", "free");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(circ);

    expect(usePatternStore.getState().orbitConfig.center).toEqual(circ.center);
    expect(useDrawingStore.getState().circles).toHaveLength(0);
  });

  it("retains a free-draw polygon annotation (no pattern, not a fence)", () => {
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "free");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(poly);

    expect(useDrawingStore.getState().polygons).toHaveLength(1);
  });

  // ---- An explicit 'pattern' tag routes to the active pattern ----
  it("routes a polygon explicitly tagged for the pattern to the active survey pattern", () => {
    usePatternStore.getState().setPatternType("survey");
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    armDraw("polygon", "pattern");

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    expect(usePatternStore.getState().surveyConfig.polygon).toEqual(poly.vertices);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Survey area set"), "success");
  });

  // ---- Defensive: a non-draw mode at completion is treated as a free draw ----
  it("treats completion under a non-draw mode as a free draw (no pattern)", () => {
    const poly = makePolygon();
    useDrawingStore.getState().addPolygon(poly);
    usePlannerStore.getState().setMode({ kind: "select" });

    const { handleDrawingComplete, toast } = buildActions();
    handleDrawingComplete(poly);

    expect(useGeofenceStore.getState().enabled).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Polygon drawn"), "success");
  });
});

describe("handleMapClick waypoint tools", () => {
  it("the loiter tool places a timed loiter the flight controller leaves on its own", () => {
    const { handleMapClick, addWaypoint } = buildActions("loiter");
    handleMapClick(12.97, 77.59);
    expect(addWaypoint).toHaveBeenCalledTimes(1);
    expect(addWaypoint.mock.calls[0][0].command).toBe("LOITER_TIME");
  });
});
