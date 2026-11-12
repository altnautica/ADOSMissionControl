/**
 * @license GPL-3.0-only
 * The upload dialog holds back a fence the plan's own mission breaks (a leg
 * through an exclusion zone, a waypoint above the fence ceiling or below its
 * floor), and holds
 * back rally points the fence forbids, so neither lands on the vehicle under
 * the mission it already holds.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevation: async () => null,
  getElevations: async (points: unknown[]) => points.map(() => null),
}));

import { SendToVehicleDialog } from "@/components/planner/SendToVehicleDialog";
import type { Planner } from "@/app/plan/use-planner";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { useMissionStore } from "@/stores/mission-store";
import type { Waypoint } from "@/lib/types";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";

const square: [number, number][] = [
  [47.0, 8.0],
  [47.0, 8.01],
  [47.01, 8.01],
  [47.01, 8.0],
];

function planner(waypoints: Waypoint[]): Planner {
  return {
    waypoints,
    drones: [],
    selectedDroneId: undefined,
    handleUpload: vi.fn(async () => ({ success: true, message: "ok" })),
  } as Partial<Planner> as Planner;
}

function renderDialog(waypoints: Waypoint[]) {
  renderWithIntl(
    <SendToVehicleDialog open onClose={() => {}} p={planner(waypoints)} showGeofence showRally />,
  );
}

const checkbox = (item: string) => screen.getByRole("checkbox", { name: new RegExp(item, "i") });

beforeEach(() => {
  useGeofenceStore.getState().clearFence();
  useRallyStore.setState({ points: [] });
  useMissionStore.setState({ waypoints: [] });
  const fence = useGeofenceStore.getState();
  fence.setEnabled(true);
  fence.setFenceType("polygon");
  fence.setPolygonPoints(square);
  fence.setMaxAltitude(100);
});

describe("SendToVehicleDialog fence rows", () => {
  it("holds back the fence when a leg crosses one of its exclusion zones", () => {
    useGeofenceStore.getState().addZone({
      role: "exclusion",
      type: "circle",
      polygonPoints: [],
      circleCenter: [47.005, 8.005],
      circleRadius: 100,
    });
    renderDialog([
      { id: "a", lat: 47.005, lon: 8.002, alt: 30 },
      { id: "b", lat: 47.005, lon: 8.008, alt: 30 },
    ]);

    expect(checkbox("geofence")).toBeDisabled();
    expect(checkbox("geofence")).not.toBeChecked();
    expect(screen.getByTestId("send-geofence-crossed")).toBeInTheDocument();
  });

  it("holds back the fence when a waypoint is above its ceiling", () => {
    renderDialog([
      { id: "a", lat: 47.004, lon: 8.004, alt: 30 },
      { id: "b", lat: 47.006, lon: 8.006, alt: 150 },
    ]);

    expect(checkbox("geofence")).toBeDisabled();
    expect(screen.getByTestId("send-geofence-crossed")).toBeInTheDocument();
  });

  it("holds back the fence when a waypoint is below its floor", () => {
    useGeofenceStore.getState().setMinAltitude(20);
    renderDialog([
      { id: "a", lat: 47.004, lon: 8.004, alt: 30 },
      { id: "b", lat: 47.006, lon: 8.006, alt: 10 },
    ]);

    expect(checkbox("geofence")).toBeDisabled();
    expect(checkbox("geofence")).not.toBeChecked();
    expect(screen.getByTestId("send-geofence-crossed")).toBeInTheDocument();
  });

  it("holds back rally points outside the fence and leaves the fence row alone", () => {
    useRallyStore.setState({ points: [{ id: "r1", lat: 47.02, lon: 8.02, alt: 40 }] });
    renderDialog([]);

    expect(checkbox("rally")).toBeDisabled();
    expect(checkbox("rally")).not.toBeChecked();
    expect(screen.getByTestId("send-rally-outside-fence")).toBeInTheDocument();
    expect(checkbox("geofence")).toBeEnabled();
    expect(screen.queryByTestId("send-geofence-crossed")).toBeNull();
  });

  it("sends a fence and rally points the mission keeps to", () => {
    useRallyStore.setState({ points: [{ id: "r1", lat: 47.005, lon: 8.005, alt: 40 }] });
    renderDialog([
      { id: "a", lat: 47.004, lon: 8.004, alt: 30 },
      { id: "b", lat: 47.006, lon: 8.006, alt: 60 },
    ]);

    expect(checkbox("geofence")).toBeEnabled();
    expect(checkbox("rally")).toBeEnabled();
  });
});
