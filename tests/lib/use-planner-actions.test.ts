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

import { usePlannerActions, reverseWaypoints, waypointForInsert } from "@/app/plan/use-planner-actions";
import { usePlannerStore } from "@/stores/planner-store";
import { usePatternStore } from "@/stores/pattern-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import type { DrawnPolygon, DrawnCircle } from "@/lib/drawing/types";
import type { DrawingFor } from "@/lib/planner-mode";
import type { Waypoint } from "@/lib/types";
import { IntlWrapper } from "../helpers/intl-wrapper";

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

type Deps = Parameters<typeof usePlannerActions>[0];

/**
 * Build the planner actions hook with no-op deps. handleDrawingComplete reads
 * the live stores directly (mode, pattern, geofence, drawing) and only needs the
 * toast callback off the deps, so the rest are stubs.
 */
function buildActions(activeTool = "polygon", over: Partial<Deps> = {}) {
  const toast = vi.fn();
  const addWaypoint = vi.fn();
  const deps: Deps = {
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
    setShowClearConfirm: vi.fn(),
    setShowDownloadConfirm: vi.fn(),
    toast,
    ...over,
  };
  const { result } = renderHook(() => usePlannerActions(deps), { wrapper: IntlWrapper });
  return { ...result.current, deps, addWaypoint, toast };
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

  it("rounds a drawn circle's radius to whole metres for the orbit", () => {
    usePatternStore.getState().setPatternType("orbit");
    const circ = { ...makeCircle(), radius: 145.99543907653433 };
    useDrawingStore.getState().addCircle(circ);
    armDraw("circle", "free");

    const { handleDrawingComplete } = buildActions();
    handleDrawingComplete(circ);

    expect(usePatternStore.getState().orbitConfig.radius).toBe(146);
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

function wp(id: string, command: Waypoint["command"], extra: Partial<Waypoint> = {}): Waypoint {
  return { id, lat: 12.9, lon: 77.5, alt: 50, command, ...extra };
}

describe("Reverse waypoints", () => {
  it("keeps a leading TAKEOFF and a trailing RTL in place", () => {
    const plan = [wp("t", "TAKEOFF"), wp("a", "WAYPOINT"), wp("b", "WAYPOINT"), wp("r", "RTL")];
    expect(reverseWaypoints(plan).map((w) => w.id)).toEqual(["t", "b", "a", "r"]);
    const setWaypoints = vi.fn();
    const { handleReverseWaypoints } = buildActions("select", { waypoints: plan, setWaypoints });
    handleReverseWaypoints();
    expect(setWaypoints.mock.calls[0][0].map((w: Waypoint) => w.id)).toEqual(["t", "b", "a", "r"]);
  });

  it("reverses everything when the plan has no takeoff or landing", () => {
    const plan = [wp("a", "WAYPOINT"), wp("b", "WAYPOINT"), wp("c", "LOITER_TIME")];
    expect(reverseWaypoints(plan).map((w) => w.id)).toEqual(["c", "b", "a"]);
  });

  it("keeps VTOL takeoff and LAND bookends", () => {
    const plan = [wp("t", "VTOL_TAKEOFF"), wp("a", "WAYPOINT"), wp("b", "WAYPOINT"), wp("l", "LAND")];
    expect(reverseWaypoints(plan).map((w) => w.id)).toEqual(["t", "b", "a", "l"]);
  });
});

describe("clearing the plan", () => {
  it("empties the plan in one undo step and keeps it open", () => {
    usePlanLibraryStore.setState({ activePlanId: "plan-open" });
    const clearMission = vi.fn();
    const setShowClearConfirm = vi.fn();
    const { confirmClear } = buildActions("select", { clearMission, setShowClearConfirm });
    confirmClear();
    expect(clearMission).toHaveBeenCalledTimes(1);
    expect(setShowClearConfirm).toHaveBeenCalledWith(false);
    // Still the same plan: clearing never closes or detaches it.
    expect(usePlanLibraryStore.getState().activePlanId).toBe("plan-open");
  });
});

describe("rally placement", () => {
  it("refuses to place a rally point with no plan open", () => {
    const addRallyPoint = vi.fn();
    const { handleMapClick, toast } = buildActions("rally", { activePlanId: null, addRallyPoint });
    handleMapClick(12.97, 77.59);
    expect(addRallyPoint).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Open or create a plan first", "info");
  });
});

describe("inserting between waypoints", () => {
  beforeEach(() => {
    usePlannerStore.setState({ defaultAlt: 50, defaultFrame: "relative" });
  });

  it("copies the preceding waypoint's altitude and frame instead of averaging datums", () => {
    const before = wp("a", "WAYPOINT", { alt: 50, frame: "relative", lat: 12.9 });
    const after = wp("b", "WAYPOINT", { alt: 500, frame: "absolute", lat: 12.91 });
    useMissionStore.setState({ waypoints: [before, after] });
    const { handleInsertAt } = buildActions("select");
    handleInsertAt(1);
    const inserted = useMissionStore.getState().waypoints[1];
    expect(inserted).toMatchObject({ command: "WAYPOINT", alt: 50, frame: "relative" });
    expect(inserted.lat).toBeCloseTo(12.905);
  });

  it("after a landing, a new waypoint takes the default height instead of 0", () => {
    const inserted = waypointForInsert(wp("l", "LAND", { alt: 0, frame: "absolute" }), { lat: 1, lon: 2 });
    expect(inserted).toMatchObject({ lat: 1, lon: 2, alt: 50, frame: "relative" });
  });
});

describe("resume upload", () => {
  it("uploads the resume mission in place of the plan and names the resume point", async () => {
    const plan = [
      wp("t", "TAKEOFF", { alt: 30 }),
      wp("a", "WAYPOINT"),
      wp("b", "WAYPOINT"),
      wp("c", "WAYPOINT"),
      wp("r", "RTL", { lat: 0, lon: 0, alt: 0 }),
    ];
    const uploadMission = vi.fn<Deps["uploadMission"]>().mockResolvedValue(true);
    const { handleUpload, toast } = buildActions("select", { waypoints: plan, uploadMission });
    const result = await handleUpload(3);
    expect(result.success).toBe(true);
    const [target, opts] = uploadMission.mock.calls[0];
    expect(target).toBeUndefined();
    const sent = opts?.waypoints ?? [];
    expect(sent.map((w) => w.command)).toEqual(["TAKEOFF", "WAYPOINT", "WAYPOINT", "RTL"]);
    expect(sent.slice(2).map((w) => w.id)).toEqual(["c", "r"]);
    expect(toast).toHaveBeenCalledWith("Resume mission from WP 4 uploaded", "success");
  });

  it("a plain upload sends the plan", async () => {
    const uploadMission = vi.fn().mockResolvedValue(true);
    const { handleUpload, toast } = buildActions("select", { uploadMission });
    await handleUpload();
    expect(uploadMission).toHaveBeenCalledWith(undefined, undefined);
    expect(toast).toHaveBeenCalledWith("Mission uploaded to drone", "success");
  });
});
