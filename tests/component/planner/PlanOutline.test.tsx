/**
 * The plan outline lists every waypoint, routes row and header clicks to the
 * selection and inspector target, and inserts between rows at the right index.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";

vi.mock("@/stores/drone-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/drone-manager")>();
  const state = {
    drones: new Map(),
    selectedDroneId: null,
    getSelectedProtocol: () => null,
    getSelectedDrone: () => null,
  };
  const useDroneManager = (sel: (s: typeof state) => unknown) => sel(state);
  useDroneManager.getState = () => state;
  return { ...actual, useDroneManager };
});
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { PlanOutline } from "@/components/planner/outline/PlanOutline";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const WPS: Waypoint[] = [
  { id: "a", lat: 12.97, lon: 77.59, alt: 0, command: "TAKEOFF" },
  { id: "b", lat: 12.98, lon: 77.6, alt: 50 },
  { id: "c", lat: 12.99, lon: 77.61, alt: 60 },
];

function makePlanner(overrides: Record<string, unknown> = {}) {
  return {
    waypoints: WPS,
    selectedWaypointId: null,
    handleWaypointClick: vi.fn(),
    removeWaypoint: vi.fn(),
    reorderWaypoints: vi.fn(),
    handleInsertAt: vi.fn(),
    handleAddManualWaypoint: vi.fn(),
    ...overrides,
  };
}

type OutlineProps = Parameters<typeof PlanOutline>[0];

function renderOutline(p = makePlanner(), opts = { showGeofence: true, showRally: true }) {
  renderWithIntl(<PlanOutline p={p as unknown as OutlineProps["p"]} {...opts} />);
  return p;
}

/** The select button of the waypoint row with this 1-based badge. */
function rowButton(n: number): HTMLElement {
  const row = document.querySelector(`[data-waypoint-id="${WPS[n - 1].id}"]`) as HTMLElement;
  return within(row).getByRole("button", { pressed: false });
}

beforeEach(() => {
  cleanup();
  useMissionStore.setState({ waypoints: WPS });
  usePlannerStore.setState({
    inspectorTarget: { kind: "mission" },
    selectedWaypointId: null,
    selectedWaypointIds: [],
    sectionOpen: {},
    defaultFrame: "relative",
  });
  useRallyStore.setState({ points: [{ id: "r1", lat: 1, lon: 2, alt: 30 }] });
  usePlanPoiStore.setState({ points: [{ id: "p1", lat: 1, lon: 2, label: "Tower" }], selectedId: null });
  useDrawingStore.setState({ polygons: [], circles: [] });
});

describe("PlanOutline mission rows", () => {
  it("renders one row per waypoint", () => {
    renderOutline();
    expect(document.querySelectorAll("[data-waypoint-id]")).toHaveLength(3);
    expect(screen.getByText("Takeoff")).toBeTruthy();
  });

  it("plain click selects, ctrl/cmd-click adds, shift-click selects a range", () => {
    const p = renderOutline();
    fireEvent.click(rowButton(2));
    expect(p.handleWaypointClick).toHaveBeenLastCalledWith("b", false, false);
    fireEvent.click(rowButton(3), { ctrlKey: true });
    expect(p.handleWaypointClick).toHaveBeenLastCalledWith("c", true, false);
    fireEvent.click(rowButton(1), { metaKey: true });
    expect(p.handleWaypointClick).toHaveBeenLastCalledWith("a", true, false);
    fireEvent.click(rowButton(3), { shiftKey: true });
    expect(p.handleWaypointClick).toHaveBeenLastCalledWith("c", false, true);
  });

  it("inserts between rows at the index of the row below", () => {
    const p = renderOutline();
    // No insert handle above the first row.
    expect(screen.queryByRole("button", { name: "Insert waypoint 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insert waypoint 3" }));
    expect(p.handleInsertAt).toHaveBeenCalledWith(2);
  });

  it("deletes a waypoint from its row", () => {
    const p = renderOutline();
    fireEvent.click(screen.getByRole("button", { name: "Delete waypoint 2" }));
    expect(p.removeWaypoint).toHaveBeenCalledWith("b");
  });

  it("reorders on drop", () => {
    const p = renderOutline();
    const rows = document.querySelectorAll("[data-waypoint-id]");
    const dataTransfer = { effectAllowed: "", dropEffect: "", types: [] };
    fireEvent.dragStart(rows[0], { dataTransfer });
    fireEvent.dragOver(rows[2], { dataTransfer });
    fireEvent.drop(rows[2], { dataTransfer });
    expect(p.reorderWaypoints).toHaveBeenCalledWith(0, 2);
  });

  it("scrolls the selected row into view when the selection changes", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const p = makePlanner();
    const { rerender } = renderWithIntl(<PlanOutline p={p as unknown as OutlineProps["p"]} showGeofence showRally />);
    rerender(<PlanOutline p={{ ...p, selectedWaypointId: "c" } as unknown as OutlineProps["p"]} showGeofence showRally />);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts[0]).toBe(document.querySelector('[data-waypoint-id="c"]'));
  });

  it("header + adds a waypoint", () => {
    const p = renderOutline();
    fireEvent.click(screen.getByRole("button", { name: "Add Waypoint" }));
    expect(p.handleAddManualWaypoint).toHaveBeenCalled();
  });
});

describe("PlanOutline row menu", () => {
  beforeEach(() => usePlannerStore.setState({ sendDialog: null }));

  it("Resume from here… opens the Send dialog in resume mode at that row", () => {
    renderOutline();
    fireEvent.contextMenu(document.querySelector('[data-waypoint-id="c"]') as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume from here…" }));
    expect(usePlannerStore.getState().sendDialog).toEqual({ resumeFromIndex: 2 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the first row cannot resume, with the reason, and Escape closes the menu", () => {
    renderOutline();
    fireEvent.contextMenu(document.querySelector('[data-waypoint-id="a"]') as HTMLElement);
    const item = screen.getByRole("menuitem", { name: "Resume from here…" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("title")).toBe("The plan starts here; upload it normally");
    fireEvent.click(item);
    expect(usePlannerStore.getState().sendDialog).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("PlanOutline groups", () => {
  it("group headers set the inspector target", () => {
    renderOutline();
    fireEvent.click(screen.getByRole("button", { name: /^Geofence/ }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "geofence" });
    fireEvent.click(screen.getByRole("button", { name: /^Rally points/ }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "rally", id: null });
    fireEvent.click(screen.getByRole("button", { name: /^Shapes/ }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "pattern" });
    fireEvent.click(screen.getByRole("button", { name: /^Mission/ }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "mission" });
  });

  it("rally and POI rows target their item", () => {
    renderOutline();
    fireEvent.click(screen.getByRole("button", { name: /^Rally 1/ }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "rally", id: "r1" });
    fireEvent.click(screen.getByRole("button", { name: /^Tower/ }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "poi", id: "p1" });
    expect(usePlanPoiStore.getState().selectedId).toBe("p1");
  });

  it("group + arms the matching tool", () => {
    renderOutline();
    fireEvent.click(screen.getByRole("button", { name: "Add rally point" }));
    expect(usePlannerStore.getState().activeTool).toBe("rally");
    fireEvent.click(screen.getByRole("button", { name: "Add point of interest" }));
    expect(usePlannerStore.getState().activeTool).toBe("poi");
  });

  it("hides geofence and rally when the firmware lacks them", () => {
    renderOutline(makePlanner(), { showGeofence: false, showRally: false });
    expect(screen.queryByRole("button", { name: /^Geofence/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Rally points/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Points of interest/ })).toBeTruthy();
  });

  it("a shape row deletes its shape", () => {
    useDrawingStore.setState({ polygons: [{ id: "poly", vertices: [], area: 25_000 }], circles: [] });
    renderOutline();
    expect(screen.getByText("2.5 ha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Polygon 1" }));
    expect(useDrawingStore.getState().polygons).toHaveLength(0);
  });

  it("collapsing a group hides its rows and persists the state", () => {
    renderOutline();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Mission" }));
    expect(usePlannerStore.getState().sectionOpen["outline.mission"]).toBe(false);
    const row = document.querySelector('[data-waypoint-id="a"]') as HTMLElement;
    expect(row.closest("[hidden]")).not.toBeNull();
  });

  it("Mission header clears a waypoint selection and shows the mission", () => {
    usePlannerStore.setState({ selectedWaypointId: "b", selectedWaypointIds: ["b"], inspectorTarget: { kind: "pattern" } });
    renderOutline(makePlanner({ selectedWaypointId: "b" }));
    fireEvent.click(screen.getByRole("button", { name: /^Mission/ }));
    const s = usePlannerStore.getState();
    expect(s.selectedWaypointId).toBeNull();
    expect(s.selectedWaypointIds).toEqual([]);
    expect(s.inspectorTarget).toEqual({ kind: "mission" });
  });

  it("a header click opens a closed inspector", () => {
    usePlannerStore.setState({ inspectorOpen: false });
    renderOutline();
    fireEvent.click(screen.getByRole("button", { name: /^Geofence/ }));
    expect(usePlannerStore.getState().inspectorOpen).toBe(true);
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "geofence" });
  });

  it("selecting a waypoint expands a collapsed Mission group", () => {
    Element.prototype.scrollIntoView = vi.fn();
    usePlannerStore.setState({ sectionOpen: { "outline.mission": false } });
    const p = makePlanner();
    const { rerender } = renderWithIntl(<PlanOutline p={p as unknown as OutlineProps["p"]} showGeofence showRally />);
    rerender(<PlanOutline p={{ ...p, selectedWaypointId: "c" } as unknown as OutlineProps["p"]} showGeofence showRally />);
    expect(usePlannerStore.getState().sectionOpen["outline.mission"]).toBe(true);
  });
});

describe("PlanOutline group header hit targets", () => {
  it("draws the collapse and add buttons at 32 px with a 48 px hit area", () => {
    renderOutline();
    const buttons = [
      screen.getByRole("button", { name: "Collapse Mission" }),
      screen.getByRole("button", { name: "Add rally point" }),
      screen.getByRole("button", { name: "Add point of interest" }),
      screen.getByRole("button", { name: "Draw geofence" }),
    ];
    for (const button of buttons) {
      expect(button.className, button.getAttribute("aria-label") ?? "").toMatch(/(^|\s)h-8 w-8(\s|$)/);
      expect(button.className).toContain("after:h-12");
      expect(button.className).toContain("after:w-12");
    }
  });
});
