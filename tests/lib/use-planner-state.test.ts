import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Same stubs as the planner-actions test: no protocol, no network terrain, and
// a no-op async storage behind the persisted planner store.
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ getSelectedProtocol: () => null }),
    setState: vi.fn(),
  },
}));
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevation: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("@/lib/mission-io", () => ({
  clearAutoSave: vi.fn().mockResolvedValue(undefined),
}));

import { usePlannerState } from "@/app/plan/use-planner-state";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";

function renderCounted() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return usePlannerState();
  });
  return { hook, renders: () => renders };
}

describe("usePlannerState subscriptions", () => {
  it("does not re-render the planner on map moves or upload warnings", () => {
    const { renders } = renderCounted();
    const before = renders();

    act(() => {
      usePlannerStore.getState().setMapCenter([12.5, 77.5]);
      usePlannerStore.getState().setMapView({ north: 1, south: 0, east: 1, west: 0 }, 14);
      useMissionStore.setState({ downloadWarnings: ["item 3 dropped"] });
    });

    expect(renders()).toBe(before);
  });

  it("re-renders when a field the planner shows changes", () => {
    const { hook, renders } = renderCounted();
    const before = renders();

    act(() => {
      usePlannerStore.getState().togglePanel();
    });

    expect(renders()).toBeGreaterThan(before);
    expect(hook.result.current.panelCollapsed).toBe(usePlannerStore.getState().panelCollapsed);
  });
});
