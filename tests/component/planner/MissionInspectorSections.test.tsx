/**
 * Mission inspector plan-level sections: the Vehicle section (hidden for
 * iNav, a reported-profile row that adopts the vehicle's profile), Home &
 * launch (planned home with its ground, the vehicle-home offer, pick on map,
 * the optional transit altitude), the profile-dependent Defaults rows, and
 * the waypoint menu's resume entry.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { PlanVehicleProfile, Waypoint } from "@/lib/types";
import type * as DroneManagerModule from "@/stores/drone-manager";

const dm = vi.hoisted(() => ({
  state: {
    drones: new Map<string, unknown>(),
    selectedDroneId: null as string | null,
  },
}));

vi.mock("@/stores/drone-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof DroneManagerModule>();
  const useDroneManager = (sel: (s: typeof dm.state) => unknown) => sel(dm.state);
  useDroneManager.getState = () => dm.state;
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
vi.mock("@/components/planner/TemplatesPanel", () => ({ TemplatesPanel: () => <div>templates</div> }));

import { VehicleSection } from "@/components/planner/inspector/VehicleSection";
import { HomeLaunchSection } from "@/components/planner/inspector/HomeLaunchSection";
import { MissionInspector } from "@/components/planner/inspector/MissionInspector";
import { WaypointMenu } from "@/components/planner/inspector/WaypointInspector";
import { DefaultsSection } from "@/components/planner/DefaultsSection";
import { vehicleHomeOffer } from "@/hooks/use-vehicle-home-offer";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { Planner } from "@/app/plan/use-planner";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const HOME = { lat: 36.1, lon: -112.1 };
const WPS: Waypoint[] = [
  { id: "a", lat: HOME.lat, lon: HOME.lon, alt: 30, command: "TAKEOFF" },
  { id: "b", lat: 36.101, lon: -112.1, alt: 40, command: "WAYPOINT" },
  { id: "c", lat: 36.102, lon: -112.1, alt: 50, command: "WAYPOINT" },
];
/** Metres of latitude per degree, for placing a point a given distance north. */
const M_PER_DEG_LAT = 111_195;

function connect(id: string, name: string, firmwareType: string, vehicleClass: string) {
  dm.state.drones.set(id, {
    id,
    name,
    protocol: { getVehicleInfo: () => ({ firmwareType, vehicleClass }) },
  });
  dm.state.selectedDroneId = id;
}

function makePlanner(overrides: Partial<Planner> = {}): Planner {
  return {
    waypoints: WPS,
    defaultAlt: 50,
    defaultSpeed: 5,
    defaultAcceptRadius: 0,
    defaultFrame: "relative",
    setDefaults: vi.fn(),
    selectedDroneId: "",
    rallyPoints: [],
    drones: [],
    updateWaypoint: vi.fn(),
    removeWaypoint: vi.fn(),
    handleInsertRelative: vi.fn(),
    ...overrides,
  } as unknown as Planner;
}

beforeEach(() => {
  dm.state.drones = new Map();
  dm.state.selectedDroneId = null;
  useTelemetryStore.getState().clear();
  useMissionStore.setState({ waypoints: WPS, plannedHome: null, vehicleProfile: null, transitAltM: null });
  usePlannerStore.setState({ homePickArmed: false, sendDialog: null, sectionOpen: {} });
});
afterEach(cleanup);

describe("MissionInspector", () => {
  it("orders the sections Drone, Home & launch, Defaults, then Plan elements", () => {
    renderWithIntl(<MissionInspector p={makePlanner()} showGeofence showRally />);
    const titles = screen.getAllByText(/^(Drone|Home & launch|Defaults|Plan elements)$/).map((n) => n.textContent);
    expect(titles).toEqual(["Drone", "Home & launch", "Defaults", "Plan elements"]);
  });
});

describe("VehicleSection", () => {
  it("is hidden for an iNav or Betaflight target", () => {
    connect("d1", "Wing", "inav", "plane");
    const { container, rerender } = renderWithIntl(<VehicleSection droneId={null} />);
    expect(container.textContent).toBe("");
    connect("d1", "Quad", "betaflight", "copter");
    rerender(<VehicleSection droneId={null} />);
    expect(container.textContent).toBe("");
  });

  it("shows the default profile with nothing connected and no mismatch row", () => {
    renderWithIntl(<VehicleSection droneId={null} />);
    expect(screen.getByRole("radio", { name: "ArduPilot" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("vehicle-profile-mismatch")).toBeNull();
  });

  it("names what a connected vehicle reports when it differs, and Use adopts it", () => {
    useMissionStore.setState({ vehicleProfile: { autopilot: "ardupilot", vehicleClass: "copter" } });
    connect("d1", "Alpha", "ardupilot-plane", "plane");
    renderWithIntl(<VehicleSection droneId="d1" />);
    const row = screen.getByTestId("vehicle-profile-mismatch");
    expect(row.textContent).toContain("Alpha reports ArduPilot plane");
    fireEvent.click(within(row).getByRole("button", { name: "Use" }));
    expect(useMissionStore.getState().vehicleProfile).toEqual<PlanVehicleProfile>({ autopilot: "ardupilot", vehicleClass: "plane" });
    expect(screen.queryByTestId("vehicle-profile-mismatch")).toBeNull();
  });

  it("sets the autopilot from the segmented control", () => {
    renderWithIntl(<VehicleSection droneId={null} />);
    fireEvent.click(screen.getByRole("radio", { name: "PX4" }));
    expect(useMissionStore.getState().vehicleProfile).toEqual({ autopilot: "px4", vehicleClass: "copter" });
  });
});

describe("HomeLaunchSection", () => {
  it("shows the planned home's ground, or that it is unknown", () => {
    useMissionStore.setState({ plannedHome: { ...HOME, groundAmsl: 412 } });
    const { rerender } = renderWithIntl(<HomeLaunchSection />);
    expect(screen.getByTestId("planned-home").textContent).toContain("412 m MSL");
    useMissionStore.setState({ plannedHome: { ...HOME } });
    rerender(<HomeLaunchSection />);
    expect(screen.getByTestId("planned-home").textContent).toContain("ground unknown");
  });

  it("offers the vehicle home only when it is more than 30 m off and at the plan's site", () => {
    useMissionStore.setState({ plannedHome: { ...HOME } });
    const push = (northM: number) =>
      useTelemetryStore.getState().pushHomePosition({ timestamp: Date.now(), lat: HOME.lat + northM / M_PER_DEG_LAT, lon: HOME.lon, alt: 400 });

    push(10);
    const { rerender } = renderWithIntl(<HomeLaunchSection />);
    expect(screen.queryByRole("button", { name: "Use drone home" })).toBeNull();

    push(100_000);
    rerender(<HomeLaunchSection />);
    expect(screen.queryByRole("button", { name: "Use drone home" })).toBeNull();

    push(500);
    rerender(<HomeLaunchSection />);
    fireEvent.click(screen.getByRole("button", { name: "Use drone home" }));
    const home = useMissionStore.getState().plannedHome!;
    expect(home.lat).toBeCloseTo(HOME.lat + 500 / M_PER_DEG_LAT, 7);
    expect(home.groundAmsl).toBe(400);
    expect(home.lon).toBe(HOME.lon);
  });

  it("arms and disarms pick-on-map", () => {
    renderWithIntl(<HomeLaunchSection />);
    fireEvent.click(screen.getByRole("button", { name: "Pick on map" }));
    expect(usePlannerStore.getState().homePickArmed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel picking on map" }));
    expect(usePlannerStore.getState().homePickArmed).toBe(false);
  });

  it("clears the transit altitude to Off", () => {
    useMissionStore.setState({ transitAltM: 120 });
    renderWithIntl(<HomeLaunchSection />);
    const field = screen.getByRole("spinbutton", { name: "Transit altitude" }) as HTMLInputElement;
    expect(field.value).toBe("120");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(useMissionStore.getState().transitAltM).toBeNull();
    expect(field.value).toBe("");
    expect(field.getAttribute("placeholder")).toBe("Off");
  });
});

describe("vehicleHomeOffer", () => {
  it("offers a home at the plan's site when no planned home is set, and never 0/0", () => {
    const vehicle = { lat: HOME.lat, lon: HOME.lon, alt: 400 };
    expect(vehicleHomeOffer(null, vehicle, WPS)).toEqual(vehicle);
    expect(vehicleHomeOffer(null, { lat: 0, lon: 0, alt: 0 }, WPS)).toBeNull();
    expect(vehicleHomeOffer(null, undefined, WPS)).toBeNull();
  });
});

describe("DefaultsSection", () => {
  const render = (profile: PlanVehicleProfile, radius = 0) => {
    const onFrameChange = vi.fn();
    const onRadiusChange = vi.fn();
    renderWithIntl(
      <DefaultsSection defaultAlt={50} defaultSpeed={5} defaultAcceptRadius={radius} defaultFrame="relative"
        vehicleProfile={profile} onAltChange={vi.fn()} onSpeedChange={vi.fn()}
        onRadiusChange={onRadiusChange} onFrameChange={onFrameChange} />,
    );
    return { onFrameChange, onRadiusChange };
  };

  it("disables the Terrain frame on PX4 with the reason", () => {
    const { onFrameChange } = render({ autopilot: "px4", vehicleClass: "copter" });
    const terrain = screen.getByRole("radio", { name: "Terrain" });
    expect(terrain.getAttribute("aria-disabled")).toBe("true");
    expect(terrain.getAttribute("title")).toBe("PX4 has no terrain frame. Use Follow terrain on patterns");
    fireEvent.click(terrain);
    expect(onFrameChange).not.toHaveBeenCalled();
  });

  it("keeps the Terrain frame available on ArduPilot", () => {
    const { onFrameChange } = render({ autopilot: "ardupilot", vehicleClass: "copter" });
    const terrain = screen.getByRole("radio", { name: "Terrain" });
    expect(terrain.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(terrain);
    expect(onFrameChange).toHaveBeenCalledWith("terrain");
  });

  it("shows a fixed wing's radius 0 as Auto (WP_RADIUS); a multirotor shows 0", () => {
    render({ autopilot: "ardupilot", vehicleClass: "plane" });
    const plane = screen.getByRole("spinbutton", { name: "Accept radius" }) as HTMLInputElement;
    expect(plane.value).toBe("");
    expect(plane.getAttribute("placeholder")).toBe("Auto (WP_RADIUS)");
    cleanup();
    render({ autopilot: "ardupilot", vehicleClass: "copter" });
    expect((screen.getByRole("spinbutton", { name: "Accept radius" }) as HTMLInputElement).value).toBe("0");
  });

  it("accepts a radius of 0", () => {
    const { onRadiusChange } = render({ autopilot: "ardupilot", vehicleClass: "copter" }, 2);
    const field = screen.getByRole("spinbutton", { name: "Accept radius" });
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    expect(onRadiusChange).toHaveBeenCalledWith(0);
  });
});

describe("WaypointMenu", () => {
  it("opens the Send dialog in resume mode from the waypoint", () => {
    renderWithIntl(<WaypointMenu p={makePlanner()} waypoint={WPS[1]} />);
    fireEvent.click(screen.getByRole("button", { name: "Waypoint actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume from here…" }));
    expect(usePlannerStore.getState().sendDialog).toEqual({ resumeFromIndex: 1 });
  });

  it("does not resume from the first waypoint", () => {
    renderWithIntl(<WaypointMenu p={makePlanner()} waypoint={WPS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Waypoint actions" }));
    const item = screen.getByRole("menuitem", { name: "Resume from here…" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(usePlannerStore.getState().sendDialog).toBeNull();
  });
});
