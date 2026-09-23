/**
 * @license GPL-3.0-only
 *
 * Replaying a run from the Simulate history loads that run's saved plan, which
 * replaces the mission and restores or clears the fence, rally points and
 * POIs. Unsaved work in the shared workspace must survive the click: the
 * operator gets the save / discard / cancel choice first.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { SimulationControls } from "@/components/simulation/SimulationControls";
import type { SimHistoryEntry, Waypoint } from "@/lib/types";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";

const wp = (id: string, lat: number): Waypoint => ({ id, lat, lon: 77.6, alt: 30 });

const SAVED = [wp("s1", 12.90), wp("s2", 12.91)];
const EDITED = [wp("e1", 13.00), wp("e2", 13.01), wp("e3", 13.02)];

function renderControls(entry: SimHistoryEntry) {
  return renderWithIntl(
    <SimulationControls
      onEditInPlanner={() => undefined}
      onExport={() => undefined}
      exportDisabled={false}
      historyEntries={[entry]}
      historyExpanded
      onToggleHistory={() => undefined}
      onClearHistory={() => undefined}
      shortcutsExpanded={false}
      onToggleShortcuts={() => undefined}
      shortcuts={[]}
    />,
  );
}

describe("Simulate history replay", () => {
  let entry: SimHistoryEntry;

  beforeEach(() => {
    const planId = usePlanLibraryStore.getState().createPlan("Saved run", SAVED);
    entry = {
      id: "run-1",
      planId,
      planName: "Saved run",
      timestamp: Date.now(),
      duration: 60,
      waypointCount: SAVED.length,
    };
    // A never-saved workspace: no active plan, an edited path and a fence.
    usePlanLibraryStore.getState().setActivePlan(null);
    useMissionStore.getState().setWaypoints(EDITED);
    useGeofenceStore.setState({ enabled: true });
  });

  afterEach(() => {
    cleanup();
    useGeofenceStore.getState().clearFence();
    usePlanLibraryStore.getState().setActivePlan(null);
  });

  it("asks before replacing unsaved work, and cancel keeps it", () => {
    renderControls(entry);
    fireEvent.click(screen.getByText("Saved run"));

    expect(screen.getByText("Discard & Switch")).toBeTruthy();
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["e1", "e2", "e3"]);
    expect(useGeofenceStore.getState().enabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["e1", "e2", "e3"]);
    expect(useGeofenceStore.getState().enabled).toBe(true);
  });

  it("loads the run's plan only after an explicit discard", () => {
    renderControls(entry);
    fireEvent.click(screen.getByText("Saved run"));
    fireEvent.click(screen.getByText("Discard & Switch"));

    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["s1", "s2"]);
    expect(usePlanLibraryStore.getState().activePlanId).toBe(entry.planId);
  });

  it("replays straight away when the workspace holds the saved plan unchanged", () => {
    const plan = usePlanLibraryStore.getState().plans.find((p) => p.id === entry.planId);
    useGeofenceStore.getState().clearFence();
    usePlanLibraryStore.getState().setActivePlan(entry.planId);
    usePlanLibraryStore.getState().savePlan(entry.planId, plan?.waypoints ?? []);
    useMissionStore.getState().setWaypoints(plan?.waypoints ?? []);

    renderControls(entry);
    fireEvent.click(screen.getByText("Saved run"));

    expect(screen.queryByText("Discard & Switch")).toBeNull();
    expect(usePlanLibraryStore.getState().activePlanId).toBe(entry.planId);
  });
});
