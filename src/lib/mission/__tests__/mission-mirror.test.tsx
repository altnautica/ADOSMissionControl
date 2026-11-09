/**
 * @license GPL-3.0-only
 *
 * When the plan on the drone differs from this device's, the map draws the
 * agent's mirror of the drone's mission (`GET /api/v1/mission`) instead of the
 * local plan, and the banner shows on the map views.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="route" data-points={positions.map((p) => p.join(",")).join(";")} />
  ),
  CircleMarker: ({ center, radius, children }: { center: [number, number]; radius: number; children?: ReactNode }) => (
    <div data-testid="wp" data-pos={center.join(",")} data-radius={radius}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

const mirror = { identity: "differs" as "differs" | "match", points: [] as { seq: number; lat: number; lon: number }[] };
vi.mock("@/lib/mission/mission-mirror", async (orig) => ({
  ...(await orig<typeof MirrorModule>()),
  useDronePlanIdentity: () => mirror.identity,
  useMissionMirror: (_d: string, enabled: boolean) => (enabled ? mirror.points : null),
}));

import type * as MirrorModule from "@/lib/mission/mission-mirror";
import { mirrorRoute } from "@/lib/mission/mission-mirror";
import { MissionRouteOverlay } from "@/components/flight/MissionRouteOverlay";
import { useMissionStore } from "@/stores/mission-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import type { Waypoint } from "@/lib/types";

const item = (seq: number, command: number, x: number, y: number) => ({
  param1: 0, param2: 0, param3: 0, param4: 0, x, y, z: 30, seq, command, frame: 3, current: 0, autocontinue: 1, mission_type: 0,
});

describe("mirrorRoute", () => {
  it("keeps positioned nav items in 1e-7 degrees, without the home slot", () => {
    const body = {
      rev: 2,
      present: true,
      count: 4,
      home_slot: true,
      items: [item(0, 16, 470000000, 80000000), item(1, 22, 470010000, 80000000), item(2, 178, 0, 0), item(3, 16, 470020000, 80010000)],
    };
    expect(mirrorRoute(body)).toEqual([
      { seq: 1, lat: 47.001, lon: 8 },
      { seq: 3, lat: 47.002, lon: 8.001 },
    ]);
  });

  it("is null before the agent has mirrored anything", () => {
    expect(mirrorRoute({ rev: 0, present: false, count: 0, home_slot: null, items: [] })).toBeNull();
  });
});

describe("MissionRouteOverlay with a differing plan", () => {
  beforeEach(() => {
    useMissionStore.setState({
      waypoints: [{ id: "a", lat: 10, lon: 10, alt: 40 }] as Waypoint[],
      currentWaypoint: 0,
    });
    useDroneManager.setState({ selectedDroneId: "drone-1" });
    useNavStreamStore.setState({
      byDrone: {
        "drone-1": { pilot: { data: { mission: { seq: 3 } } as PilotState, receivedAt: Date.now() } } as never,
      },
    });
    mirror.points = [
      { seq: 1, lat: 47.001, lon: 8 },
      { seq: 3, lat: 47.002, lon: 8.001 },
    ];
  });
  afterEach(() => {
    cleanup();
    useDroneManager.setState({ selectedDroneId: null });
    useNavStreamStore.setState({ byDrone: {} });
  });

  it("draws the drone's mirrored route, not the local plan", () => {
    mirror.identity = "differs";
    const { container, getByText } = render(<MissionRouteOverlay />);
    expect(container.querySelector('[data-testid="route"]')?.getAttribute("data-points")).toBe("47.001,8;47.002,8.001");
    const active = Array.from(container.querySelectorAll('[data-testid="wp"]')).filter(
      (m) => m.getAttribute("data-radius") === "8",
    );
    expect(active.map((m) => m.getAttribute("data-pos"))).toEqual(["47.002,8.001"]);
    expect(getByText("WP 2")).toBeTruthy();
  });

  it("draws the local plan when the plans match", () => {
    mirror.identity = "match";
    const { container } = render(<MissionRouteOverlay />);
    expect(container.querySelector('[data-testid="route"]')).toBeNull();
    expect(container.querySelector('[data-testid="wp"]')?.getAttribute("data-pos")).toBe("10,10");
  });
});
