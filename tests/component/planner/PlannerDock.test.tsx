/**
 * Component tests for the planner dock: the strip's mission summary (unit
 * formatting included), tab switching through the planner store, issue rows
 * (a terrain-clash leg included) selecting their waypoint, and checklist ticks
 * surviving a collapse.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";
import { renderWithIntl } from "../../helpers/intl-wrapper";

// Pin the plan's distance and duration so the summary is deterministic:
// 1500 m over 150 s is a 10 m/s route mean, unlike the 5 m/s default passed in.
const flightPlan = vi.hoisted(() => ({
  segments: [],
  totalDistance: 1500,
  totalDuration: 150,
  maxAboveHomeM: 100,
  openEnded: false,
  altitudesApproximate: false,
}));
vi.mock("@/lib/flight-plan", () => ({ computeFlightPlan: () => flightPlan }));
const planOptions = vi.hoisted(() => ({}));
vi.mock("@/hooks/use-rtl-return-context", () => ({ useFlightPlanOptions: () => planOptions }));
const validationOptions = vi.hoisted(() => ({}));
vi.mock("@/hooks/use-validation-options", () => ({ useValidationOptions: () => validationOptions }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Two blocking issues (one tied to waypoint "wp-2", one a terrain-clash leg
// starting at "wp-1"), one warning with no waypoint.
vi.mock("@/lib/validation/mission-validator", () => ({
  validateMission: (wps: unknown[]) =>
    wps.length === 0
      ? { valid: true, errors: [], warnings: [] }
      : {
          valid: false,
          errors: [
            { severity: "blocking", code: "x", message: "", text: { key: "wpOutsideGeofencePolygon", params: { v0: 2 } }, waypointId: "wp-2" },
            {
              severity: "blocking", code: "LEG_TERRAIN_CLEARANCE", message: "", text: { key: "legTerrainUnchecked", params: { from: 1, to: 2 } },
              waypointId: "wp-1", leg: { toWaypointId: "wp-2", clearanceM: -12, alongM: 300 },
            },
          ],
          warnings: [{ severity: "advisory", code: "y", message: "", text: { key: "homeNotSet" } }],
        },
}));
vi.mock("@/components/planner/MissionAdvisories", () => ({ MissionAdvisories: () => null }));

import { PlannerDock } from "@/components/planner/dock/PlannerDock";
import { usePlannerStore, type DockTab } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { PREFLIGHT_ITEM_IDS } from "@/components/planner/preflight-items";

const waypoints = [
  { id: "wp-1", lat: 12.9, lon: 77.6, alt: 100 },
  { id: "wp-2", lat: 12.91, lon: 77.61, alt: 80 },
] as unknown as Waypoint[];

function makeP(overrides: Partial<{ waypoints: Waypoint[] }> = {}) {
  // The strip's statistics read the open plan from the mission store.
  useMissionStore.setState({ waypoints: overrides.waypoints ?? waypoints });
  return {
    waypoints: overrides.waypoints ?? waypoints,
    selectedWaypointId: null,
    setSelectedWaypoint: vi.fn(),
  };
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

/** Drive the dock through the store, as a shortcut does. Block body: the
 * persisted store's setter returns a promise that `act` must not await. */
function setDock(dockTab: DockTab, open?: boolean) {
  act(() => {
    usePlannerStore.getState().setDock(dockTab, open);
  });
}

beforeEach(() => {
  flightPlan.openEnded = false;
  flightPlan.altitudesApproximate = false;
  usePlannerStore.setState({ dockOpen: false, dockTab: "altitude" });
  usePreflightChecklistStore.getState().clear();
  useSettingsStore.setState({ units: "metric" });
});

describe("PlannerDock strip", () => {
  it("summarises the mission in metric units", () => {
    renderWithIntl(<PlannerDock p={makeP()} />);
    expect(screen.getByText("2 WP")).toBeDefined();
    expect(screen.getByText("1.50 km")).toBeDefined();
    expect(screen.getByText("~3 min")).toBeDefined();
    expect(screen.getByText("100 m max above home")).toBeDefined();
    expect(screen.getByText("10.0 m/s avg")).toBeDefined();
  });

  it("follows the units setting", () => {
    useSettingsStore.setState({ units: "imperial" });
    renderWithIntl(<PlannerDock p={makeP()} />);
    // 1500 m < 1 mi → feet; 100 m → 328 ft; 10 m/s → 22.4 mph.
    expect(screen.getByText("4921 ft")).toBeDefined();
    expect(screen.getByText("328 ft max above home")).toBeDefined();
    expect(screen.getByText("22.4 mph avg")).toBeDefined();
    expect(screen.queryByText("1.50 km")).toBeNull();
  });

  it("marks an open-ended ETA and an approximate height", () => {
    flightPlan.openEnded = true;
    flightPlan.altitudesApproximate = true;
    renderWithIntl(<PlannerDock p={makeP()} />);
    expect(screen.getByText("~3+ min")).toBeDefined();
    expect(screen.getByTitle("Ends in an unlimited loiter")).toBeDefined();
    expect(screen.getByText("~100 m max above home")).toBeDefined();
  });

  it("shows no summary for an empty plan but keeps the tabs", () => {
    renderWithIntl(<PlannerDock p={makeP({ waypoints: [] })} />);
    expect(screen.queryByText(/WP$/)).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("badges the issue count and checklist progress", () => {
    renderWithIntl(<PlannerDock p={makeP()} />);
    expect(tab(/^Issues/).textContent).toBe("Issues3");
    expect(tab(/^Checklist/).textContent).toBe(`Checklist0/${PREFLIGHT_ITEM_IDS.length}`);
  });
});

describe("PlannerDock tabs", () => {
  it("opens a tab on click and collapses on a second click", () => {
    renderWithIntl(<PlannerDock p={makeP()} />);
    expect(tab(/^Terrain/).getAttribute("aria-selected")).toBe("false");

    fireEvent.click(tab(/^Terrain/));
    expect(usePlannerStore.getState()).toMatchObject({ dockOpen: true, dockTab: "terrain" });
    expect(tab(/^Terrain/).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tab(/^Energy/));
    expect(usePlannerStore.getState()).toMatchObject({ dockOpen: true, dockTab: "energy" });

    fireEvent.click(tab(/^Energy/));
    expect(usePlannerStore.getState().dockOpen).toBe(false);
    expect(tab(/^Energy/).getAttribute("aria-selected")).toBe("false");
  });

  it("follows the store when a shortcut opens a tab", () => {
    renderWithIntl(<PlannerDock p={makeP()} />);
    setDock("issues", true);
    expect(tab(/^Issues/).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Issues");
  });

  it("selects the waypoint an issue row points at", async () => {
    const p = makeP();
    renderWithIntl(<PlannerDock p={p} />);
    setDock("issues", true);
    // The panel validates after a 500 ms debounce.
    const row = await screen.findByText("WP2: Outside geofence polygon", undefined, { timeout: 2000 });
    fireEvent.click(row);
    expect(p.setSelectedWaypoint).toHaveBeenCalledWith("wp-2");
    expect(screen.getByText("2 errors, 1 warning")).toBeDefined();
  });

  it("a terrain-clash row selects the leg's start waypoint", async () => {
    const p = makeP();
    renderWithIntl(<PlannerDock p={p} />);
    setDock("issues", true);
    fireEvent.click(await screen.findByText("WP1 to WP2: terrain along the leg not checked (no ground profile or home elevation yet)", undefined, { timeout: 2000 }));
    expect(p.setSelectedWaypoint).toHaveBeenCalledWith("wp-1");
  });

  it("keeps checklist ticks across a collapse and re-expand", () => {
    renderWithIntl(<PlannerDock p={makeP()} />);
    setDock("checklist", true);
    const item = screen.getByRole("button", { name: "Battery charged and secured" });
    fireEvent.click(item);
    expect(item.getAttribute("aria-pressed")).toBe("true");

    // Collapse: the checklist unmounts.
    setDock("checklist");
    expect(screen.queryByRole("button", { name: "Battery charged and secured" })).toBeNull();
    expect(tab(/^Checklist/).textContent).toBe(`Checklist1/${PREFLIGHT_ITEM_IDS.length}`);

    // Re-expand: the tick is still there.
    setDock("checklist", true);
    expect(
      screen.getByRole("button", { name: "Battery charged and secured" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
