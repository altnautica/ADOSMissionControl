/**
 * @license GPL-3.0-only
 * Pattern-apply gate: a mission that already has waypoints confirms before a
 * destructive replace; an empty mission applies directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// planner-store / plan-library-store (pulled in transitively) persist to
// IndexedDB — stub the storage engine so import does not hit the real one.
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

// mission-io runs an IndexedDB-backed migration at import time (no indexedDB in
// the test env); stub the only symbol the actions hook pulls from it.
vi.mock("@/lib/mission-io", () => ({ clearAutoSave: vi.fn(async () => {}) }));

import { usePlannerActions } from "@/app/plan/use-planner-actions";
import { usePatternStore } from "@/stores/pattern-store";
import type { Waypoint } from "@/lib/types";
import type { PatternResult } from "@/lib/patterns/types";

const RESULT: PatternResult = {
  waypoints: [
    { lat: 12.9, lon: 77.5, alt: 50, speed: 5, command: "WAYPOINT" },
    { lat: 12.91, lon: 77.51, alt: 50, speed: 5, command: "WAYPOINT" },
  ],
  stats: { totalDistance: 1200, estimatedTime: 120, photoCount: 0, coveredArea: 0, transectCount: 2 },
};

const EXISTING: Waypoint[] = [{ id: "w1", lat: 1, lon: 2, alt: 3, command: "WAYPOINT" }];

type Deps = Parameters<typeof usePlannerActions>[0];

function makeDeps(over: Partial<Deps> = {}): Deps {
  return {
    waypoints: [],
    activePlanId: "plan-1",
    isDirty: false,
    activeTool: "select",
    defaultAlt: 50,
    defaultSpeed: 5,
    defaultAcceptRadius: 0,
    selectedDroneId: "",
    missionName: "",
    contextMenu: null,
    addWaypoint: vi.fn(),
    removeWaypoint: vi.fn(),
    insertWaypoint: vi.fn(),
    clearMission: vi.fn(),
    setWaypoints: vi.fn(),
    downloadMission: vi.fn(async () => []),
    uploadMission: vi.fn(async () => true),
    addRallyPoint: vi.fn(),
    setContextMenu: vi.fn(),
    setSelectedWaypoint: vi.fn(),
    setExpandedWaypoint: vi.fn(),
    setShowClearConfirm: vi.fn(),
    setShowPatternApplyConfirm: vi.fn(),
    setShowDownloadConfirm: vi.fn(),
    setMissionName: vi.fn(),
    setSelectedDroneId: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  usePatternStore.setState({ patternResult: RESULT });
});

describe("handlePatternApply gate", () => {
  it("existing waypoints → opens the confirm and does not replace", () => {
    const deps = makeDeps({ waypoints: EXISTING });
    const { result } = renderHook(() => usePlannerActions(deps));
    result.current.handlePatternApply();
    expect(deps.setShowPatternApplyConfirm).toHaveBeenCalledWith(true);
    expect(deps.setWaypoints).not.toHaveBeenCalled();
  });

  it("empty mission → applies directly with no confirm", () => {
    const deps = makeDeps({ waypoints: [] });
    const { result } = renderHook(() => usePlannerActions(deps));
    result.current.handlePatternApply();
    expect(deps.setShowPatternApplyConfirm).not.toHaveBeenCalled();
    expect(deps.setWaypoints).toHaveBeenCalledTimes(1);
  });

  it("applyPatternConfirmed → closes the confirm and applies", () => {
    const deps = makeDeps({ waypoints: EXISTING });
    const { result } = renderHook(() => usePlannerActions(deps));
    result.current.applyPatternConfirmed();
    expect(deps.setShowPatternApplyConfirm).toHaveBeenCalledWith(false);
    expect(deps.setWaypoints).toHaveBeenCalledTimes(1);
  });

  it("no pattern generated → neither confirms nor applies", () => {
    usePatternStore.setState({ patternResult: null });
    const deps = makeDeps({ waypoints: EXISTING });
    const { result } = renderHook(() => usePlannerActions(deps));
    result.current.handlePatternApply();
    expect(deps.setShowPatternApplyConfirm).not.toHaveBeenCalled();
    expect(deps.setWaypoints).not.toHaveBeenCalled();
  });
});
