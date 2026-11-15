/**
 * @license GPL-3.0-only
 *
 * The Flight map draws the mission route and the waypoint the aircraft is
 * heading to only while MISSION_CURRENT maps onto the open plan; a plan the
 * aircraft does not hold (no current waypoint) is never drawn as its route.
 * The waypoints the drone skipped (`mission.gaps`) are marked as skipped.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="route" data-points={positions.length} />
  ),
  CircleMarker: ({ center, radius, children }: { center: [number, number]; radius: number; children?: ReactNode }) => (
    <div data-testid="wp" data-pos={center.join(",")} data-radius={radius}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { MissionRouteOverlay } from "../MissionRouteOverlay";
import { useMissionStore } from "@/stores/mission-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useUploadReceiptsStore } from "@/stores/upload-receipts-store";
import { missionContentHash, missionSeqToWaypointIndex } from "@/lib/mission-upload";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import stallFrame from "@/lib/cockpit/layers/fixtures/pilot-frame-stall.json";
import type { Waypoint } from "@/lib/types";

const route = [
  { id: "a", lat: 47.0, lon: 8.0, alt: 40 },
  { id: "b", lat: 47.001, lon: 8.0, alt: 40 },
  { id: "c", lat: 47.001, lon: 8.001, alt: 40 },
  { id: "d", lat: 47.0, lon: 8.001, alt: 40 },
] as Waypoint[];

beforeEach(() => {
  useMissionStore.setState({ waypoints: route, currentWaypoint: null });
});
afterEach(() => {
  cleanup();
  useDroneManager.setState({ selectedDroneId: null });
  useNavStreamStore.setState({ byDrone: {} });
  useUploadReceiptsStore.getState().clearForDrone("drone-1");
});

describe("MissionRouteOverlay", () => {
  it("draws nothing while no current waypoint maps onto the plan", () => {
    const { container } = render(<MissionRouteOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("draws the route and marks the waypoint being flown to", () => {
    useMissionStore.setState({ currentWaypoint: 2 });
    const { container, getByText } = render(<MissionRouteOverlay />);

    expect(container.querySelector('[data-testid="route"]')?.getAttribute("data-points")).toBe("4");
    const markers = Array.from(container.querySelectorAll('[data-testid="wp"]'));
    expect(markers).toHaveLength(4);
    const active = markers.filter((m) => m.getAttribute("data-radius") === "8");
    expect(active.map((m) => m.getAttribute("data-pos"))).toEqual(["47.001,8.001"]);
    expect(getByText("WP 3")).toBeTruthy();
  });

  it("marks the waypoints the drone skipped, mapped onto the plan it holds", () => {
    // The golden stall frame reports seq 2 skipped; the plan's waypoint for
    // it is the one MISSION_CURRENT seq 2 maps to.
    const frame = stallFrame as { data?: unknown };
    const pilot = parsePilotState(frame.data ?? frame)!;
    expect(pilot.mission?.gaps.map((g) => g.seq)).toEqual([2]);
    useDroneManager.setState({ selectedDroneId: "drone-1" });
    useNavStreamStore.getState().setPilot("drone-1", pilot);
    // The receipt matches this plan and the drone's reported total (6 items).
    useUploadReceiptsStore.getState().record("mission", {
      droneId: "drone-1",
      contentHash: missionContentHash(route, { transitAltM: null }),
      at: Date.now(),
      total: 6,
    });
    useMissionStore.setState({ currentWaypoint: 3 });
    const index = missionSeqToWaypointIndex(route, 2, false, { transitAltM: null });
    expect(index).not.toBeNull();

    const { container, getByText } = render(<MissionRouteOverlay />);

    const skipped = Array.from(container.querySelectorAll('[data-testid="wp"]')).filter(
      (m) => m.getAttribute("data-radius") === "6",
    );
    const wp = route[index!];
    expect(skipped.map((m) => m.getAttribute("data-pos"))).toEqual([`${wp.lat},${wp.lon}`]);
    expect(getByText(`WP ${index! + 1} · Skipped`)).toBeTruthy();
  });

  it("marks nothing skipped once the open plan is no longer the one the drone holds", () => {
    const frame = stallFrame as { data?: unknown };
    useDroneManager.setState({ selectedDroneId: "drone-1" });
    useNavStreamStore.getState().setPilot("drone-1", parsePilotState(frame.data ?? frame)!);
    useUploadReceiptsStore.getState().record("mission", {
      droneId: "drone-1",
      contentHash: "an-earlier-edit",
      at: Date.now(),
      total: 6,
    });
    useMissionStore.setState({ currentWaypoint: 3 });

    const { container } = render(<MissionRouteOverlay />);

    expect(container.querySelectorAll('[data-testid="wp"][data-radius="6"]')).toHaveLength(0);
  });
});
