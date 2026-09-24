import { describe, it, expect, beforeEach, vi } from "vitest";

// The planner store persists through IndexedDB, which is not available in the
// test environment. Stub the storage engine with an in-memory map so persist
// writes are silent no-ops and never reject in the background.
vi.mock("@/lib/storage", () => {
  const mem = new Map<string, string>();
  return {
    indexedDBStorage: {
      storage: () => ({
        getItem: async (name: string) => mem.get(name) ?? null,
        setItem: async (name: string, value: string) => {
          mem.set(name, value);
        },
        removeItem: async (name: string) => {
          mem.delete(name);
        },
      }),
    },
  };
});

import { usePlannerStore } from "@/stores/planner-store";
import { usePatternStore } from "@/stores/pattern-store";
import { selectPatternType } from "@/stores/pattern-selection";
import { useDrawingStore } from "@/stores/drawing-store";
import { DEFAULT_PLANNER_MODE } from "@/lib/planner-mode";

describe("planner-store interaction mode", () => {
  beforeEach(() => {
    // Reset to the idle defaults synchronously.
    usePlannerStore.setState({ mode: DEFAULT_PLANNER_MODE, activeTool: "select" });
    useDrawingStore.getState().clearAll();
    usePatternStore.getState().clear();
  });

  it("boots into the idle select mode", () => {
    expect(usePlannerStore.getState().mode).toEqual({ kind: "select" });
    expect(usePlannerStore.getState().activeTool).toBe("select");
  });

  it("setActiveTool drives both the mode and the derived activeTool", () => {
    usePlannerStore.getState().setActiveTool("waypoint");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "waypoint", tool: "waypoint" });
    expect(usePlannerStore.getState().activeTool).toBe("waypoint");

    usePlannerStore.getState().setActiveTool("polygon");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "draw", shape: "polygon", drawingFor: "free" });
    expect(usePlannerStore.getState().activeTool).toBe("polygon");

    usePlannerStore.getState().setActiveTool("rally");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "rally" });
    expect(usePlannerStore.getState().activeTool).toBe("rally");
  });

  it("a draw tool sets the drawing store's mode", () => {
    usePlannerStore.getState().setActiveTool("circle");
    expect(useDrawingStore.getState().drawingMode).toBe("circle");
  });

  it("switching away from a draw tool clears the drawing store's mode", () => {
    usePlannerStore.getState().setActiveTool("polygon");
    expect(useDrawingStore.getState().drawingMode).toBe("polygon");
    usePlannerStore.getState().setActiveTool("select");
    expect(useDrawingStore.getState().drawingMode).toBeNull();
  });

  it("keeps an armed flight pattern through the draw and select tools (the boundary-draw flow)", () => {
    // The pattern-boundary flow arms a pattern, draws its polygon with the draw
    // tool, and rests in select while the pattern stays armed. Clearing the
    // pattern on those switches would wipe it mid-setup, so it must survive them.
    usePatternStore.setState({ activePatternType: "survey" });
    usePlannerStore.getState().setActiveTool("polygon");
    expect(usePatternStore.getState().activePatternType).toBe("survey");
    usePlannerStore.getState().setActiveTool("select");
    expect(usePatternStore.getState().activePatternType).toBe("survey");
  });

  it("clears a stale armed pattern when switching to plain waypoint or rally placement", () => {
    // Moving on to placing a different kind of point abandons the pattern; this
    // also stops a later free-hand draw from being captured by the stale pattern.
    usePatternStore.setState({ activePatternType: "survey" });
    usePlannerStore.getState().setActiveTool("waypoint");
    expect(usePatternStore.getState().activePatternType).toBeNull();

    usePatternStore.setState({ activePatternType: "orbit" });
    usePlannerStore.getState().setActiveTool("rally");
    expect(usePatternStore.getState().activePatternType).toBeNull();
  });

  it("captures the active search pattern onto the datum mode when arming the datum tool", () => {
    usePatternStore.setState({ activePatternType: "sectorSearch" });
    usePlannerStore.getState().setActiveTool("datum");
    // The datum mode carries the armed pattern so the map click reads the
    // authoritative mode, not a sibling store.
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: "sectorSearch" });
    expect(usePatternStore.getState().activePatternType).toBe("sectorSearch");
  });

  it("arms datum with no pattern for a non-datum active pattern (landing patterns)", () => {
    usePatternStore.setState({ activePatternType: "vtolLanding" });
    usePlannerStore.getState().setActiveTool("datum");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: null });
  });

  it("armDatum arms datum placement for the given pattern", () => {
    usePatternStore.setState({ activePatternType: null });
    usePlannerStore.getState().armDatum("parallelTrack");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: "parallelTrack" });
    expect(usePlannerStore.getState().activeTool).toBe("datum");
  });

  it("re-points an armed datum at the newly-active pattern (no stale datum target)", () => {
    selectPatternType("expandingSquare");
    usePlannerStore.getState().setActiveTool("datum");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: "expandingSquare" });
    // Switching the active pattern while datum stays armed re-points the datum,
    // so the next click can never set the previously-active pattern's origin.
    selectPatternType("parallelTrack");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: "parallelTrack" });
    // A landing pattern is not a datum pattern, so it disarms the origin.
    selectPatternType("vtolLanding");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: null });
  });

  it("switching from a draw tool to another draw tool keeps no stale shape", () => {
    usePlannerStore.getState().setActiveTool("polygon");
    usePlannerStore.getState().setActiveTool("measure");
    expect(usePlannerStore.getState().mode).toEqual({ kind: "draw", shape: "measure", drawingFor: "free" });
    expect(useDrawingStore.getState().drawingMode).toBe("measure");
  });

  it("setMode arms a datum for a specific pattern without touching the pattern store arm", () => {
    usePlannerStore.getState().setMode({ kind: "datum", pattern: "orbit" });
    expect(usePlannerStore.getState().mode).toEqual({ kind: "datum", pattern: "orbit" });
    expect(usePlannerStore.getState().activeTool).toBe("datum");
  });
});

describe("planner-store persist migrate", () => {
  const migrate = usePlannerStore.persist.getOptions().migrate;

  it("exposes a migrate handler", () => {
    expect(typeof migrate).toBe("function");
  });

  it("a v1 payload (no mode) seeds the default mode and preserves defaults", () => {
    const v1Payload = {
      defaultAlt: 120,
      defaultSpeed: 8,
      defaultAcceptRadius: 5,
      defaultFrame: "absolute" as const,
    };
    const migrated = migrate!(v1Payload, 1) as Record<string, unknown>;
    expect(migrated.mode).toEqual(DEFAULT_PLANNER_MODE);
    // Persisted defaults survive the migration untouched.
    expect(migrated.defaultAlt).toBe(120);
    expect(migrated.defaultSpeed).toBe(8);
    expect(migrated.defaultAcceptRadius).toBe(5);
    expect(migrated.defaultFrame).toBe("absolute");
  });

  it("a v2 payload passes through without overwriting an existing mode", () => {
    const v2Payload = {
      defaultAlt: 50,
      defaultSpeed: 5,
      defaultAcceptRadius: 2,
      defaultFrame: "relative" as const,
      mode: { kind: "rally" as const },
    };
    const migrated = migrate!(v2Payload, 2) as Record<string, unknown>;
    expect(migrated.mode).toEqual({ kind: "rally" });
    expect(migrated.defaultAlt).toBe(50);
  });
});
