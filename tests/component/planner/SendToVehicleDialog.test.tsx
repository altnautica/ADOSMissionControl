/**
 * Send to vehicle dialog: only applicable items are offered, validation errors
 * block the mission, items run in order and a failure does not stop the rest.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const mocks = vi.hoisted(() => ({ errors: [] as unknown[] }));

vi.mock("@/hooks/use-validation-options", () => ({ useValidationOptions: () => ({}) }));
vi.mock("@/lib/validation/mission-validator", () => ({ validateMission: () => ({ errors: mocks.errors, warnings: [] }) }));

import { SendToVehicleDialog } from "@/components/planner/SendToVehicleDialog";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlannerStore } from "@/stores/planner-store";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { PREFLIGHT_ITEM_IDS } from "@/components/planner/preflight-items";
import { useDroneManager, type DroneManagerState } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useMissionStore } from "@/stores/mission-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useMissionStateStore, type MissionStateKind } from "@/lib/mission/mission-state";

const initialDroneManager = useDroneManager.getState();

type DialogProps = ComponentProps<typeof SendToVehicleDialog>;

const calls: string[] = [];

function makePlanner(
  handleUpload: () => Promise<{ success: boolean; message: string }>,
  extra: Record<string, unknown> = {},
) {
  return {
    waypoints: [
      { id: "w1", lat: 1, lon: 1, alt: 30, command: "WAYPOINT" },
      { id: "w2", lat: 1.001, lon: 1, alt: 30, command: "WAYPOINT" },
    ],
    handleUpload,
    drones: [],
    selectedDroneId: "",
    ...extra,
  } as unknown as DialogProps["p"];
}

/** Seed connected drones by id; the dialog only checks membership. */
function seedDrones(ids: string[], selected: string | null) {
  const drones = new Map(ids.map((id) => [id, { id }])) as unknown as DroneManagerState["drones"];
  useDroneManager.setState({ drones, selectedDroneId: selected });
}

/** The per-drone flight state the heartbeat writes to the node registry. */
/** The C8 mission state the link computes for `id`. */
function report(id: string, state: MissionStateKind) {
  useMissionStateStore.setState((s) => ({
    status: {
      ...s.status,
      [id]: {
        state,
        seq: 1,
        total: 2,
        itemReached: null,
        id: null,
        source: "mission_state",
        ageMs: 0,
        landingSeq: false,
      },
    },
  }));
}

function renderDialog(props: Partial<DialogProps> = {}) {
  const all: DialogProps = {
    open: true,
    onClose: vi.fn(),
    p: makePlanner(async () => { calls.push("mission"); return { success: true, message: "Mission uploaded to FC" }; }),
    showGeofence: true,
    showRally: true,
    ...props,
  };
  renderWithIntl(<SendToVehicleDialog {...all} />);
  return all;
}

beforeEach(() => {
  calls.length = 0;
  mocks.errors = [];
  useGeofenceStore.setState({
    fenceType: "polygon",
    polygonPoints: [[1, 1], [1, 1.01], [1.01, 1.01]],
    circleCenter: null,
    zones: [],
    uploadFence: vi.fn(async () => { calls.push("geofence"); return { success: false, message: "Fence rejected" }; }),
  });
  useRallyStore.setState({
    points: [{ id: "r1", lat: 1, lon: 1, alt: 40 }],
    uploadRallyPoints: vi.fn(async () => { calls.push("rally"); return { success: true, message: "Rally uploaded" }; }),
  });
  usePlannerStore.setState({ dockOpen: false, dockTab: "altitude" });
  usePreflightChecklistStore.setState({ checked: {} });
  useDroneManager.setState(initialDroneManager, true);
  useDroneStore.setState({ armState: "disarmed", flightMode: "STABILIZE" });
  useMissionStore.setState({ vehicleProfile: null });
  useNodeRegistryStore.getState().clear();
  useMissionStateStore.setState({ inputs: {}, status: {} });
});
afterEach(cleanup);

describe("SendToVehicleDialog", () => {
  it("offers mission, geofence and rally when each is present", () => {
    renderDialog();
    expect(screen.getByLabelText("Mission (2 items)")).toBeChecked();
    expect(screen.getByLabelText("Geofence")).toBeChecked();
    expect(screen.getByLabelText("Rally points (1)")).toBeChecked();
  });

  it("hides geofence and rally when unsupported or empty", () => {
    useRallyStore.setState({ points: [] });
    renderDialog({ showGeofence: false });
    expect(screen.queryByLabelText("Geofence")).toBeNull();
    expect(screen.queryByLabelText(/Rally points/)).toBeNull();
  });

  it("runs selected items in order and continues after a failure", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["mission", "geofence", "rally"]));
    await waitFor(() => {
      expect(within(screen.getByTestId("send-row-mission")).getByText("Sent")).toBeInTheDocument();
      expect(within(screen.getByTestId("send-row-geofence")).getByText("Failed")).toBeInTheDocument();
      expect(within(screen.getByTestId("send-row-geofence")).getByText("Fence rejected")).toBeInTheDocument();
      expect(within(screen.getByTestId("send-row-rally")).getByText("Sent")).toBeInTheDocument();
    });
  });

  it("keeps going when an item throws", async () => {
    renderDialog({ p: makePlanner(async () => { calls.push("mission"); throw new Error("link lost"); }) });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["mission", "geofence", "rally"]));
    await waitFor(() => expect(within(screen.getByTestId("send-row-mission")).getByText("link lost")).toBeInTheDocument());
  });

  it("skips deselected items", async () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText("Geofence"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["mission", "rally"]));
  });

  it("blocks the mission on validation errors and links to the issues tab", async () => {
    mocks.errors = [{}];
    const { onClose } = renderDialog();
    const mission = screen.getByLabelText("Mission (2 items)");
    expect(mission).not.toBeChecked();
    expect(mission).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toEqual(["geofence", "rally"]));
    fireEvent.click(screen.getByRole("button", { name: "Review issues" }));
    expect(usePlannerStore.getState().dockOpen).toBe(true);
    expect(usePlannerStore.getState().dockTab).toBe("issues");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows checklist progress and opens the checklist tab", () => {
    usePreflightChecklistStore.setState({ checked: { [PREFLIGHT_ITEM_IDS[0]]: true } });
    const { onClose } = renderDialog();
    expect(screen.getByText(`Pre-flight checklist 1/${PREFLIGHT_ITEM_IDS.length}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open checklist" }));
    expect(usePlannerStore.getState().dockTab).toBe("checklist");
    expect(onClose).toHaveBeenCalled();
  });

  it("names the vehicle that receives the upload", () => {
    seedDrones(["d1"], "d1");
    renderDialog({ p: makePlanner(async () => ({ success: true, message: "" }), {
      drones: [{ id: "d1", name: "Alpha" }], selectedDroneId: "d1",
    }) });
    expect(screen.getByText("Sends to Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("send-target-mismatch")).toBeNull();
  });

  it("warns when the plan is assigned to another connected vehicle and offers a switch", () => {
    seedDrones(["d1", "d2"], "d2");
    const selectDrone = vi.fn();
    useDroneManager.setState({ selectDrone });
    renderDialog({ p: makePlanner(async () => ({ success: true, message: "" }), {
      drones: [{ id: "d1", name: "Alpha" }, { id: "d2", name: "Bravo" }], selectedDroneId: "d1",
    }) });
    expect(screen.getByText("Sends to Bravo")).toBeInTheDocument();
    expect(screen.getByText("This plan is assigned to Alpha. Sending goes to Bravo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Alpha" }));
    expect(selectDrone).toHaveBeenCalledWith("d1");
  });

  it("blocks every row while the target is armed and flying its mission", () => {
    seedDrones(["d1"], "d1");
    report("d1", "active");
    renderDialog();
    for (const [label, item] of [["Mission (2 items)", "mission"], ["Geofence", "geofence"], ["Rally points (1)", "rally"]]) {
      const box = screen.getByLabelText(label);
      expect(box).toBeDisabled();
      expect(box).not.toBeChecked();
      expect(screen.getByTestId(`send-${item}-flying`)).toHaveTextContent("Pause the mission before uploading");
    }
  });

  it("reads the target's own mission state, not the selected drone's", () => {
    seedDrones(["d1", "d2"], "d1");
    report("d2", "loaded");
    report("d1", "active");
    renderDialog();
    expect(screen.getByLabelText("Mission (2 items)")).toBeDisabled();
    expect(screen.getByLabelText("Geofence")).toBeDisabled();
  });

  it("allows every row once the mission is paused", () => {
    seedDrones(["d1"], "d1");
    report("d1", "paused");
    renderDialog();
    expect(screen.getByLabelText("Mission (2 items)")).toBeChecked();
    expect(screen.getByLabelText("Geofence")).toBeChecked();
    expect(screen.queryByTestId("send-mission-flying")).toBeNull();
  });

  it("names a plan written for another autopilot and vehicle class", () => {
    const protocol = { getVehicleInfo: () => ({ firmwareType: "ardupilot-plane", vehicleClass: "plane" }) };
    const drones = new Map([["d1", { id: "d1", protocol }]]) as unknown as DroneManagerState["drones"];
    useDroneManager.setState({ drones, selectedDroneId: "d1" });
    useMissionStore.setState({ vehicleProfile: { autopilot: "px4", vehicleClass: "copter" } });
    renderDialog();
    expect(screen.getByTestId("send-profile-mismatch")).toHaveTextContent(
      "Planned for PX4 multirotor; target is ArduPilot plane",
    );
  });

  it("in resume mode uploads the resume mission from the chosen waypoint", async () => {
    const handleUpload = vi.fn(async (_resumeFromIndex?: number) => ({ success: true, message: "Resume mission from WP 2 uploaded" }));
    renderDialog({ p: makePlanner(handleUpload), resumeFromIndex: 1 });
    const row = screen.getByLabelText(
      "Uploads a mission that takes off, restores speed and camera, and continues from WP 2",
    );
    expect(row).toBeChecked();
    fireEvent.click(screen.getByLabelText("Geofence"));
    fireEvent.click(screen.getByLabelText("Rally points (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(handleUpload).toHaveBeenCalledWith(1));
  });
});
