/**
 * Planner bar: the primary action label carries the send state, the issues
 * chip opens the dock, the overflow menu keeps every plan action, and the
 * inline name commits on blur and reverts on Escape.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, renderHook } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderWithIntl, IntlWrapper } from "../../helpers/intl-wrapper";
import type { FleetDrone } from "@/lib/types";
import messages from "../../../locales/en.json";

const mocks = vi.hoisted(() => ({
  errors: [] as unknown[],
  status: "none" as string,
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/plan" }));
vi.mock("@/hooks/use-validation-options", () => ({ useValidationOptions: () => ({}) }));
vi.mock("@/lib/validation/mission-validator", () => ({ validateMission: () => ({ errors: mocks.errors, warnings: [] }) }));
vi.mock("@/hooks/use-upload-status", () => ({ useMissionUploadStatus: () => mocks.status }));

import { PlannerBar } from "@/app/plan/PlannerBar";
import { useVehicleOptions } from "@/app/plan/use-vehicle-options";
import { usePlannerStore } from "@/stores/planner-store";
import { useRallyStore } from "@/stores/rally-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useClockStore } from "@/stores/clock-store";
import { useDroneManager, type DroneManagerState } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { useUiStore } from "@/stores/ui-store";

type BarProps = ComponentProps<typeof PlannerBar>;

function makePlanner(overrides: Record<string, unknown> = {}) {
  return {
    waypoints: [{ id: "w1", lat: 1, lon: 1, alt: 30, command: "WAYPOINT" }],
    missionName: "Survey north",
    setMissionName: vi.fn(),
    drones: [],
    selectedDroneId: "",
    setSelectedDroneId: vi.fn(),
    isDirty: true,
    uploadState: "idle",
    downloadState: "idle",
    handleSave: vi.fn(),
    handleDownloadFromDrone: vi.fn(),
    handleExportNative: vi.fn(),
    handleExportWaypoints: vi.fn(),
    handleExportPlan: vi.fn(),
    handleExportKML: vi.fn(),
    handleExportKMZ: vi.fn(),
    handleExportCSV: vi.fn(),
    handleSaveAs: vi.fn(),
    handleReverseWaypoints: vi.fn(),
    handleClearAll: vi.fn(),
    ...overrides,
  } as unknown as BarProps["p"];
}

function makeShareIo(): BarProps["shareIo"] {
  return {
    boundaryInput: null,
    handleImportBoundary: vi.fn(),
    handleExportBrief: vi.fn(),
    handleCopyShareLink: vi.fn(async () => {}),
  };
}

function renderBar(props: Partial<BarProps> = {}) {
  const all: BarProps = {
    p: makePlanner(),
    hasDrone: true,
    showGeofence: true,
    showRally: true,
    shareIo: makeShareIo(),
    onOpenSend: vi.fn(),
    ...props,
  };
  renderWithIntl(<PlannerBar {...all} />);
  return all;
}

beforeEach(() => {
  mocks.errors = [];
  mocks.status = "none";
  mocks.push.mockReset();
  usePlannerStore.setState({
    dockOpen: false, dockTab: "altitude", inspectorOpen: false,
    inspectorTarget: { kind: "mission" }, librarySheetOpen: false,
  });
  useRallyStore.setState({ points: [] });
  useGeofenceStore.setState({ circleCenter: null, polygonPoints: [], zones: [] });
});
afterEach(cleanup);

describe("PlannerBar send button", () => {
  it("reads 'Upload to drone' and opens the send dialog", () => {
    const { onOpenSend } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Upload to drone" }));
    expect(onOpenSend).toHaveBeenCalledTimes(1);
  });

  it("reads 'Uploading…' while the upload runs", () => {
    renderBar({ p: makePlanner({ uploadState: "uploading" }) });
    const btn = screen.getByRole("button", { name: /Uploading…/ });
    expect(btn).toBeDisabled();
  });

  it("reads 'Uploaded ✓' once the vehicle holds exactly this mission", () => {
    mocks.status = "on-aircraft";
    renderBar({ p: makePlanner({ uploadState: "uploaded" }) });
    expect(screen.getByRole("button", { name: "Uploaded ✓" })).toBeInTheDocument();
  });

  it("reads 'Fix n errors' and leads to the issues when only the mission could be sent", () => {
    mocks.errors = [{}, {}];
    const { onOpenSend } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 errors" }));
    expect(onOpenSend).not.toHaveBeenCalled();
    expect(usePlannerStore.getState().dockOpen).toBe(true);
    expect(usePlannerStore.getState().dockTab).toBe("issues");
  });

  it("opens the dialog despite mission errors when rally points can still be sent", () => {
    mocks.errors = [{}];
    useRallyStore.setState({ points: [{ id: "r1", lat: 1, lon: 1, alt: 30 }] });
    const { onOpenSend } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Fix 1 error" }));
    expect(onOpenSend).toHaveBeenCalledTimes(1);
  });

  it("is enabled with no waypoints when a rally point can be sent", () => {
    useRallyStore.setState({ points: [{ id: "r1", lat: 1, lon: 1, alt: 30 }] });
    const { onOpenSend } = renderBar({ p: makePlanner({ waypoints: [] }) });
    const btn = screen.getByRole("button", { name: "Upload to drone" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOpenSend).toHaveBeenCalledTimes(1);
    cleanup();
    renderBar({ p: makePlanner({ waypoints: [] }), showRally: false });
    expect(screen.getByRole("button", { name: "Upload to drone" })).toBeDisabled();
  });

  it("is disabled without a vehicle or without waypoints", () => {
    renderBar({ hasDrone: false });
    expect(screen.getByRole("button", { name: "Upload to drone" })).toBeDisabled();
    cleanup();
    renderBar({ p: makePlanner({ waypoints: [] }) });
    expect(screen.getByRole("button", { name: "Upload to drone" })).toBeDisabled();
  });
});

describe("PlannerBar vehicle select", () => {
  const alpha = {
    id: "d1", name: "Alpha", status: "online", connectionState: "connected",
    flightMode: "STABILIZE", armState: "disarmed", lastHeartbeat: Date.now(), fcAttached: true,
  } as FleetDrone;
  const initialManager = useDroneManager.getState();
  afterEach(() => useDroneManager.setState(initialManager, true));

  function pickAlpha(selectedDroneId: string | null) {
    const selectDrone = vi.fn();
    const drones = new Map([["d1", { id: "d1" }]]) as unknown as DroneManagerState["drones"];
    useDroneManager.setState({ drones, selectedDroneId, selectDrone });
    const p = makePlanner({ drones: [alpha] });
    renderBar({ p });
    fireEvent.click(screen.getByRole("combobox", { name: "Drone" }));
    fireEvent.click(screen.getByRole("option", { name: /^Alpha/ }));
    return { selectDrone, p };
  }

  it("makes a connected vehicle the upload target when no drone is selected", () => {
    const { selectDrone, p } = pickAlpha(null);
    expect(p.setSelectedDroneId).toHaveBeenCalledWith("d1");
    expect(selectDrone).toHaveBeenCalledWith("d1");
  });

  it("leaves a drone selected elsewhere as the target", () => {
    const { selectDrone, p } = pickAlpha("d2");
    expect(p.setSelectedDroneId).toHaveBeenCalledWith("d1");
    expect(selectDrone).not.toHaveBeenCalled();
  });
});

describe("PlannerBar issues chip", () => {
  it("is hidden with no errors", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /error/ })).toBeNull();
  });

  it("opens the dock on the issues tab", () => {
    mocks.errors = [{}, {}, {}];
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "3 errors" }));
    expect(usePlannerStore.getState().dockOpen).toBe(true);
    expect(usePlannerStore.getState().dockTab).toBe("issues");
  });
});

describe("PlannerBar plans button", () => {
  it("toggles the library sheet", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Plans" }));
    expect(usePlannerStore.getState().librarySheetOpen).toBe(true);
  });
});

describe("PlannerBar overflow menu", () => {
  const en = messages.planner;
  const ITEMS: [label: string, handler: string, from: "p" | "shareIo"][] = [
    ["Download from drone", "handleDownloadFromDrone", "p"],
    [en.import.boundary.menuLabel, "handleImportBoundary", "shareIo"],
    ["Export .altmission (lossless)", "handleExportNative", "p"],
    [en.exportWaypoints, "handleExportWaypoints", "p"],
    [en.exportPlanQgc, "handleExportPlan", "p"],
    [en.exportKml, "handleExportKML", "p"],
    ["Export KMZ", "handleExportKMZ", "p"],
    [en.exportCsv, "handleExportCSV", "p"],
    [en.export.brief.menuLabel, "handleExportBrief", "shareIo"],
    [en.share.copyLink, "handleCopyShareLink", "shareIo"],
    ["Save as new plan", "handleSaveAs", "p"],
    ["Reverse waypoints", "handleReverseWaypoints", "p"],
    ["Clear plan", "handleClearAll", "p"],
  ];

  function openMenu() {
    fireEvent.click(screen.getByRole("button", { name: "More plan actions" }));
  }

  it("contains every plan action and each one runs its handler", () => {
    for (const [label, handler, from] of ITEMS) {
      const props = renderBar();
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      const owner = (from === "p" ? props.p : props.shareIo) as unknown as Record<string, ReturnType<typeof vi.fn>>;
      expect(owner[handler], label).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("Transform mission… points the inspector at transform and opens it", () => {
    renderBar();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Transform mission…" }));
    expect(usePlannerStore.getState().inspectorTarget).toEqual({ kind: "transform" });
    expect(usePlannerStore.getState().inspectorOpen).toBe(true);
  });

  it("Simulate in 3D navigates to the simulator", () => {
    renderBar();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Simulate in 3D" }));
    expect(mocks.push).toHaveBeenCalledWith("/simulate");
  });
});

describe("PlannerBar upload progress, failure and fly", () => {
  afterEach(() => {
    useMissionStore.setState({ uploadProgress: null, uploadError: null, uploadErrorCode: null });
    useLaunchRequestStore.setState({ pending: null });
  });

  it("counts the items the drone has taken while the upload runs", () => {
    useMissionStore.setState({ uploadProgress: { sent: 3, total: 12 } });
    renderBar({ p: makePlanner({ uploadState: "uploading" }) });
    expect(screen.getByRole("button", { name: /Uploading 3\/12/ })).toBeInTheDocument();
  });

  it("puts a refused upload into words, never the raw result number", () => {
    useMissionStore.setState({ uploadError: "Mission rejected: type 4", uploadErrorCode: 4 });
    renderBar({ p: makePlanner({ uploadState: "error" }) });
    const chip = screen.getByText("Upload failed");
    expect(chip.getAttribute("title")).toBe("Upload failed: The flight controller has no room for a mission this long.");
  });

  it("offers Fly this mission once the drone holds the plan, opening its Flight tab with Launch set to the mission", () => {
    mocks.status = "on-aircraft";
    useDroneManager.setState({ selectedDroneId: "d1" });
    renderBar({ p: makePlanner({ uploadState: "uploaded" }) });
    fireEvent.click(screen.getByRole("button", { name: "More plan actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Fly this mission" }));
    expect(mocks.push).toHaveBeenCalledWith("/");
    expect(useUiStore.getState().pendingDetailTab).toBe("cockpit");
    expect(useLaunchRequestStore.getState().pending).toMatchObject({ droneId: "d1", after: "mission" });
  });

  it("does not offer Fly this mission before the plan is on the drone", () => {
    useDroneManager.setState({ selectedDroneId: "d1" });
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "More plan actions" }));
    expect(screen.queryByRole("menuitem", { name: "Fly this mission" })).toBeNull();
  });
});

describe("PlannerBar plan name", () => {
  it("commits on blur, not per keystroke", () => {
    const { p } = renderBar();
    const input = screen.getByRole("textbox", { name: "Plan name" });
    fireEvent.change(input, { target: { value: "Survey south" } });
    expect(p.setMissionName).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(p.setMissionName).toHaveBeenCalledWith("Survey south");
  });

  it("reverts on Escape without committing", () => {
    const { p } = renderBar();
    const input = screen.getByRole("textbox", { name: "Plan name" }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Typo" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(p.setMissionName).not.toHaveBeenCalled();
    expect(input.value).toBe("Survey north");
  });

  it("reverts an empty name instead of committing it", () => {
    const { p } = renderBar();
    const input = screen.getByRole("textbox", { name: "Plan name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(p.setMissionName).not.toHaveBeenCalled();
    expect(input.value).toBe("Survey north");
  });
});

describe("vehicle options battery label", () => {
  function drone(extra: Partial<FleetDrone>): FleetDrone {
    return {
      id: "d1", name: "Alpha", status: "online", connectionState: "connected",
      flightMode: "STABILIZE", armState: "disarmed", lastHeartbeat: Date.now(),
      ...extra,
    } as FleetDrone;
  }
  const labelOf = (d: FleetDrone) =>
    renderHook(() => useVehicleOptions([d]), { wrapper: IntlWrapper }).result.current[1]?.label;
  // A slow worker reaches these tests long after the clock store last read the time.
  beforeEach(() => useClockStore.setState({ now: Date.now() - 10_000 }));

  it("shows a dash when no battery has been received", () => {
    expect(labelOf(drone({}))).toBe("Alpha (—)");
  });

  it("does not offer a node without a flight controller", () => {
    const { result } = renderHook(
      () => useVehicleOptions([drone({ fcAttached: false, battery: { timestamp: Date.now(), voltage: 0, remaining: 0 } })]),
      { wrapper: IntlWrapper },
    );
    expect(result.current.map((o) => o.value)).toEqual([""]);
  });

  it("shows a fresh reading as a plain percentage", () => {
    expect(labelOf(drone({ fcAttached: true, battery: { timestamp: Date.now(), voltage: 16, remaining: 72.4 } }))).toBe("Alpha (72%)");
  });

  it("marks a reading that stopped updating as stale", () => {
    expect(labelOf(drone({ fcAttached: true, battery: { timestamp: Date.now() - 60_000, voltage: 16, remaining: 72 } }))).toBe("Alpha (72%, stale)");
  });

  it("offers busy flight vehicles and leaves out offline ones", () => {
    const { result } = renderHook(
      () => useVehicleOptions([
        drone({ id: "flying", name: "Alpha-01", status: "in_mission", fcAttached: true }),
        drone({ id: "away", name: "Bravo-02", status: "offline" }),
        drone({ id: "gs", name: "Ground Station Alpha", fcAttached: false }),
      ]),
      { wrapper: IntlWrapper },
    );
    expect(result.current.map((o) => o.value)).toEqual(["", "flying"]);
  });

  it("keeps the plan's vehicle listed so the select never goes blank", () => {
    const { result } = renderHook(
      () => useVehicleOptions([drone({ id: "away", name: "Bravo-02", status: "offline" })], "away"),
      { wrapper: IntlWrapper },
    );
    expect(result.current.map((o) => o.value)).toEqual(["", "away"]);

    const unknown = renderHook(() => useVehicleOptions([], "gone-1"), { wrapper: IntlWrapper });
    expect(unknown.result.current.at(-1)).toEqual({ value: "gone-1", label: "gone-1" });
  });
});
