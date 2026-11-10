/**
 * @license GPL-3.0-only
 *
 * The tile map's point menu: a touch held for the spec's long-press duration
 * opens it like a right-click (Fly here when the pilot offers a goto), and on
 * the ground, with the pilot advertising `goto` and a cockpit on screen to
 * take it, it offers Launch here, which stores the point with its north/east
 * about the EKF origin for the Launch sheet.
 */

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const container = document.createElement("div");
const fakeMap = {
  getContainer: () => container,
  on: vi.fn(),
  off: vi.fn(),
  tapHold: { disable: vi.fn() },
  mouseEventToContainerPoint: (e: MouseEvent) => ({ x: e.clientX, y: e.clientY }),
  // 1 px = 1e-5 degrees about (12.97, 77.59), y down = south.
  containerPointToLatLng: (p: { x: number; y: number }) => ({ lat: 12.97 - p.y * 1e-5, lng: 77.59 + p.x * 1e-5 }),
  latLngToContainerPoint: (ll: [number, number] | { lat: number; lng: number }) => {
    const [lat, lng] = Array.isArray(ll) ? ll : [ll.lat, ll.lng];
    return { x: (lng - 77.59) / 1e-5, y: (12.97 - lat) / 1e-5 };
  },
};
vi.mock("react-leaflet", () => ({ useMap: () => fakeMap }));

import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { MapContextMenu } from "@/components/map/MapContextMenu";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { nedToLatLon } from "@/lib/nav/ned-geo";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useGpsOriginStore } from "@/stores/gps-origin-store";
import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { handleLaunchHere } from "../actions/navigation";
import { useMenuContext, useMenuItems } from "../use-menu-items";
import { latLonToNed } from "../../map-point";

const DRONE = "d-point-menu";
const ORIGIN = { timestamp: 0, lat: 12.97, lon: 77.59, alt: 900 };
const base = parsePilotState(pilotFixture)!;
const flying: PilotState = { ...base, controlMode: "ados", surfaceOps: ["goto"], armed: true, landed: false };
const grounded: PilotState = { ...base, controlMode: "ados", surfaceOps: ["goto"], armed: false, landed: true };

function setPilot(p: PilotState) {
  useNavStreamStore.setState({
    byDrone: { [DRONE]: { pilot: { data: p, receivedAt: Date.now() } } } as never,
  });
}

function itemIds(): string[] {
  const ctx = renderHook(() => useMenuContext()).result.current;
  return renderHook(() => useMenuItems(ctx)).result.current.map((i) => i.id);
}

describe("tile map point menu", () => {
  beforeEach(() => {
    useDroneManager.setState({ selectedDroneId: DRONE });
    useDroneStore.setState({ connectionState: "connected", armState: "disarmed", flightMode: "STABILIZE" });
    useLaunchRequestStore.setState({ pending: null });
    useFlightScreenStore.setState({ mounted: 1 });
  });
  afterEach(() => {
    cleanup();
    useNavStreamStore.setState({ byDrone: {} });
    useGpsOriginStore.getState().clear(DRONE);
    useFlightScreenStore.setState({ mounted: 0 });
  });

  it("a touch held for map_long_press_ms opens the menu with Fly here", () => {
    vi.useFakeTimers();
    useDroneStore.setState({ connectionState: "armed", armState: "armed", flightMode: "ALT_HOLD" });
    setPilot(flying);
    render(<MapContextMenu />);
    expect(fakeMap.tapHold.disable).toHaveBeenCalled();
    fireEvent.pointerDown(container, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 50, clientY: 40 });
    act(() => vi.advanceTimersByTime(layoutSpec.map_long_press_ms - 1));
    expect(screen.queryByText("Fly Here")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Fly Here")).toBeTruthy();
  });

  it("offers Launch here on the ground only with the EKF origin known", () => {
    setPilot(grounded);
    expect(itemIds()).not.toContain("launch-here");
    useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
    expect(itemIds()).toContain("launch-here");
    expect(itemIds()).not.toContain("fly-here");

    setPilot(flying);
    expect(itemIds()).not.toContain("launch-here");
  });

  it("offers Launch here only while a cockpit is on screen to open Launch", () => {
    setPilot(grounded);
    useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
    useFlightScreenStore.setState({ mounted: 0 });
    expect(itemIds()).not.toContain("launch-here");
    useFlightScreenStore.setState({ mounted: 1 });
    expect(itemIds()).toContain("launch-here");
  });

  it("Launch here stores the point with its north/east about the origin", () => {
    const [lat, lon] = nedToLatLon(ORIGIN, 30, -12);
    const report = vi.fn();
    handleLaunchHere({
      droneId: DRONE,
      menuPos: { x: 0, y: 0, lat, lon },
      origin: ORIGIN,
      requestLaunch: useLaunchRequestStore.getState().requestLaunch,
      report,
    });
    const pending = useLaunchRequestStore.getState().pending!;
    expect(pending).toMatchObject({ droneId: DRONE, lat, lon });
    expect(pending.north).toBeCloseTo(30, 6);
    expect(pending.east).toBeCloseTo(-12, 6);
    expect(report).not.toHaveBeenCalled();
    expect(latLonToNed(ORIGIN, ORIGIN.lat, ORIGIN.lon)).toEqual([0, 0]);
  });
});
