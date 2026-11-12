/**
 * The planner map layers: leg insert handles, the planned home and the vehicle
 * home ghost, terrain-clash legs, battery change badges and the implicit legs.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Waypoint } from "@/lib/types";

/** What a mocked react-leaflet layer was rendered with, keyed by its DOM node. */
const layers = vi.hoisted(() => new WeakMap<Element, Record<string, unknown>>());

vi.mock("react-leaflet", () => {
  const layer = (kind: string) =>
    function MockLayer(props: Record<string, unknown> & { children?: ReactNode }) {
      return (
        <div data-testid={kind} ref={(el) => { if (el) layers.set(el, props); }}>
          {props.children}
        </div>
      );
    };
  return {
    Marker: layer("marker"),
    Polyline: layer("polyline"),
    Tooltip: ({ children }: { children?: ReactNode }) => <span data-testid="tooltip">{children}</span>,
    useMapEvents: () => null,
  };
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

const validation = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/hooks/use-planner-validation", () => ({
  usePlannerValidation: () => validation.result,
}));

const flight = vi.hoisted(() => ({ plan: null as unknown, energy: null as unknown }));
vi.mock("@/hooks/use-planner-flight-plan", () => ({
  usePlannerFlightPlan: () => flight.plan,
  usePlanEnergy: () => ({ plan: flight.plan, energy: flight.energy }),
}));

import { LegInsertHandles } from "@/components/planner/map/LegInsertHandles";
import { PlannedHomeLayer } from "@/components/planner/map/PlannedHomeLayer";
import { TerrainClashLayer } from "@/components/planner/map/TerrainClashLayer";
import { BatteryChangeBadges } from "@/components/planner/map/BatteryChangeBadges";
import { ImplicitLegsLayer } from "@/components/planner/map/ImplicitLegsLayer";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { clearHistory, undoDepth, undoHistory } from "@/lib/planner-history";
import { renderWithIntl } from "../../helpers/intl-wrapper";

interface LayerProps {
  position?: [number, number];
  positions?: [number, number][];
  title?: string;
  icon?: { options: { html?: string } };
  eventHandlers?: Record<string, (e: unknown) => void>;
}

function rendered(kind: "marker" | "polyline"): { el: HTMLElement; props: LayerProps }[] {
  return screen.queryAllByTestId(kind).map((el) => ({ el, props: layers.get(el) as LayerProps }));
}

/** Fire a mocked layer's Leaflet handler with a minimal Leaflet-shaped event. */
function fire(props: LayerProps, name: string, extra: Record<string, unknown> = {}) {
  act(() => {
    props.eventHandlers?.[name]?.({ originalEvent: { stopPropagation: () => {} }, ...extra });
  });
}

const WPS: Waypoint[] = [
  { id: "a", lat: 12.97, lon: 77.59, alt: 0, command: "TAKEOFF" },
  { id: "b", lat: 12.972, lon: 77.592, alt: 45, frame: "terrain", command: "WAYPOINT" },
  { id: "c", lat: 12.974, lon: 77.596, alt: 70, frame: "relative", command: "WAYPOINT" },
  { id: "d", lat: 12.976, lon: 77.598, alt: 70, frame: "relative", command: "WAYPOINT" },
];

beforeEach(() => {
  clearHistory();
  useTelemetryStore.getState().clear();
  useMissionStore.setState({ waypoints: WPS, plannedHome: null, transitAltM: null });
  usePlannerStore.setState({
    activeTool: "select", homePickArmed: false, selectedWaypointId: null, selectedWaypointIds: [],
    dockOpen: false, dockTab: "altitude",
  });
  validation.result = null;
  flight.plan = { segments: [] };
  flight.energy = null;
});

describe("LegInsertHandles", () => {
  it("click inserts a waypoint at the leg midpoint with the preceding altitude and frame", () => {
    renderWithIntl(<LegInsertHandles waypoints={WPS} zoom={16} enabled />);
    const handles = rendered("marker");
    expect(handles).toHaveLength(3);
    // The b→c leg: the new waypoint takes b's 45 m terrain-frame altitude.
    const bc = handles.find((h) => h.props.position?.[0] === (WPS[1].lat + WPS[2].lat) / 2)!;
    fire(bc.props, "click");
    const wps = useMissionStore.getState().waypoints;
    expect(wps.map((w) => w.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(wps[2]).toMatchObject({
      lat: (WPS[1].lat + WPS[2].lat) / 2,
      lon: (WPS[1].lon + WPS[2].lon) / 2,
      alt: 45,
      frame: "terrain",
      command: "WAYPOINT",
    });
    expect(wps[3].id).toBe("c");
  });

  it("drag inserts the waypoint where the handle is dropped", () => {
    renderWithIntl(<LegInsertHandles waypoints={WPS} zoom={15} enabled />);
    const cd = rendered("marker")[2];
    fire(cd.props, "dragend", { target: { getLatLng: () => ({ lat: 12.9755, lng: 77.5999 }) } });
    const wps = useMissionStore.getState().waypoints;
    expect(wps[3]).toMatchObject({ lat: 12.9755, lon: 77.5999, alt: 70, frame: "relative" });
    expect(wps[4].id).toBe("d");
  });

  it("is hidden below zoom 15 and while drawing", () => {
    const { rerender } = renderWithIntl(<LegInsertHandles waypoints={WPS} zoom={14} enabled />);
    expect(rendered("marker")).toHaveLength(0);
    rerender(<LegInsertHandles waypoints={WPS} zoom={17} enabled={false} />);
    expect(rendered("marker")).toHaveLength(0);
  });
});

describe("PlannedHomeLayer", () => {
  const HOME = { lat: 12.9701, lon: 77.5901, groundAmsl: 412 };

  it("shows the planned home with its ground and a drag is one undo step", () => {
    useMissionStore.setState({ plannedHome: HOME });
    renderWithIntl(<PlannedHomeLayer />);
    expect(screen.getByText("Planned home · 412 m MSL")).toBeInTheDocument();
    const [home] = rendered("marker");
    const before = undoDepth();
    fire(home.props, "dragend", { target: { getLatLng: () => ({ lat: 12.971, lng: 77.591 }) } });
    expect(useMissionStore.getState().plannedHome).toEqual({ lat: 12.971, lon: 77.591 });
    expect(undoDepth()).toBe(before + 1);
    act(() => undoHistory());
    expect(useMissionStore.getState().plannedHome).toEqual(HOME);
  });

  it("draws no vehicle-home ghost for a home more than 50 km from the plan", () => {
    useMissionStore.setState({ plannedHome: HOME });
    // Grand Canyon plan, Bangalore vehicle.
    useMissionStore.setState({ waypoints: [{ id: "g", lat: 36.06, lon: -112.14, alt: 0, command: "TAKEOFF" }] });
    useTelemetryStore.getState().pushHomePosition({ timestamp: Date.now(), lat: 12.9716, lon: 77.5946, alt: 900 });
    renderWithIntl(<PlannedHomeLayer />);
    expect(rendered("marker").filter((m) => m.props.title === "Drone home")).toHaveLength(0);
  });

  it("draws no ghost within 30 m of the planned home", () => {
    useMissionStore.setState({ plannedHome: HOME });
    useTelemetryStore.getState().pushHomePosition({ timestamp: Date.now(), lat: 12.97015, lon: 77.59015, alt: 900 });
    renderWithIntl(<PlannedHomeLayer />);
    expect(rendered("marker").filter((m) => m.props.title === "Drone home")).toHaveLength(0);
  });

  it("offers a vehicle home 200 m away as the planned home", () => {
    useMissionStore.setState({ plannedHome: HOME });
    useTelemetryStore.getState().pushHomePosition({ timestamp: Date.now(), lat: 12.972, lon: 77.5901, alt: 905 });
    renderWithIntl(<PlannedHomeLayer />);
    const ghost = rendered("marker").find((m) => m.props.title === "Drone home")!;
    expect(ghost).toBeDefined();
    fire(ghost.props, "click", { target: { getElement: () => ghost.el } });
    fireEvent.click(screen.getByRole("button", { name: "Use as planned home" }));
    expect(useMissionStore.getState().plannedHome).toEqual({ lat: 12.972, lon: 77.5901, groundAmsl: 905 });
  });
});

describe("TerrainClashLayer", () => {
  it("draws the clashing leg; a click selects its start waypoint and opens Issues", () => {
    validation.result = {
      valid: false,
      warnings: [],
      errors: [{
        severity: "blocking", code: "LEG_TERRAIN_CLEARANCE", message: "", text: { key: "homeNotSet" },
        waypointIndex: 1, waypointId: "b", leg: { toWaypointId: "c", clearanceM: -12.2, alongM: 140 },
      }],
    };
    renderWithIntl(<TerrainClashLayer waypoints={WPS} />);
    const [leg] = rendered("polyline");
    expect(leg.props.positions).toEqual([[WPS[1].lat, WPS[1].lon], [WPS[2].lat, WPS[2].lon]]);
    expect(screen.getByText("Clips terrain by 12 m")).toBeInTheDocument();
    fire(leg.props, "click");
    const planner = usePlannerStore.getState();
    expect(planner.selectedWaypointId).toBe("b");
    expect(planner.dockTab).toBe("issues");
    expect(planner.dockOpen).toBe(true);
  });

  it("draws nothing without a terrain clash", () => {
    validation.result = { valid: true, warnings: [], errors: [] };
    renderWithIntl(<TerrainClashLayer waypoints={WPS} />);
    expect(rendered("polyline")).toHaveLength(0);
  });
});

describe("BatteryChangeBadges", () => {
  it("badges the waypoint where pack 2 starts", () => {
    flight.energy = {
      packs: [
        { fromIndex: 0, toIndex: 1, energyWh: 100, durationS: 600 },
        { fromIndex: 2, toIndex: 3, energyWh: 80, durationS: 500 },
      ],
    };
    renderWithIntl(<BatteryChangeBadges waypoints={WPS} />);
    const badges = rendered("marker");
    expect(badges).toHaveLength(1);
    expect(badges[0].props.position).toEqual([WPS[2].lat, WPS[2].lon]);
    expect(badges[0].props.icon?.options.html).toContain("⚡2");
  });

  it("draws no badge for a one-pack plan", () => {
    flight.energy = { packs: [{ fromIndex: 0, toIndex: 3, energyWh: 100, durationS: 600 }] };
    renderWithIntl(<BatteryChangeBadges waypoints={WPS} />);
    expect(rendered("marker")).toHaveLength(0);
  });
});

describe("ImplicitLegsLayer", () => {
  it("draws the implicit legs and labels a transit leg with its height", () => {
    const pt = (lat: number, lon: number, alt: number) => ({ lat, lon, alt });
    flight.plan = {
      segments: [
        { kind: "climb", implicit: false, distance: 0, fromIndex: 0, toIndex: 0, from: pt(1, 1, 0), to: pt(1, 1, 120) },
        { kind: "transit", implicit: true, distance: 300, fromIndex: 0, toIndex: 1, from: pt(1, 1, 120), to: pt(1.002, 1, 120) },
        { kind: "leg", implicit: false, distance: 200, fromIndex: 1, toIndex: 2, from: pt(1.002, 1, 50), to: pt(1.004, 1, 50) },
        { kind: "return", implicit: true, distance: 500, fromIndex: 3, toIndex: 3, from: pt(1.004, 1, 50), to: pt(1, 1, 50) },
      ],
    };
    renderWithIntl(<ImplicitLegsLayer />);
    expect(rendered("polyline")).toHaveLength(2);
    const labels = rendered("marker");
    expect(labels).toHaveLength(1);
    expect(labels[0].props.icon?.options.html).toContain("↑ 120 m");
  });
});
