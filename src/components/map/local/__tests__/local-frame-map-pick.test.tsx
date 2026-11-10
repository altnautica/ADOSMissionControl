/**
 * @license GPL-3.0-only
 *
 * A point picked on the local-frame map (right-click, or a touch held for the
 * spec's long-press duration) converts from local north/east to
 * latitude/longitude about the EKF origin. In the air, with the pilot
 * offering a goto, it opens the Fly here hold-confirm; on the ground, with
 * the pilot advertising `goto`, it requests the Launch sheet.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/cockpit/v2/MissionPlanIdentityBanner", () => ({ MissionPlanIdentityBanner: () => null }));
vi.mock("@/components/map/local/use-occupancy-bitmaps", () => ({
  useOccupancyBitmaps: () => ({ lookup: () => null }),
}));
vi.mock("@/components/map/local/use-local-frame-data", () => ({
  useLocalFrameData: () => ({
    now: Date.now(),
    trail: [],
    occupancy: { seq: 0, resM: null, tileCells: null, tiles: {} },
    occupancyStale: false,
    scanPoints: null,
    target: null,
    // The view centres on the drone.
    drone: { north: 4, east: -2, yawDeg: 0 },
    fcPos: false,
  }),
}));

import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { DEFAULT_LOCAL_ZOOM } from "@/lib/hud/local-scene";
import { nedToLatLon } from "@/lib/nav/ned-geo";
import { useDroneStore } from "@/stores/drone-store";
import { useGpsOriginStore } from "@/stores/gps-origin-store";
import { useGuidedStore } from "@/stores/guided-store";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "node:local-pick-test";
const ORIGIN = { timestamp: 0, lat: 12.97, lon: 77.59, alt: 900 };
const LONG_PRESS_MS = layoutSpec.map_long_press_ms;

const base = parsePilotState(pilotFixture)!;
const flying: PilotState = { ...base, controlMode: "ados", surfaceOps: ["goto"], armed: true, landed: false };
const grounded: PilotState = { ...base, controlMode: "ados", surfaceOps: ["goto"], armed: false, landed: true };

function setPilot(p: PilotState) {
  useNavStreamStore.setState({
    byDrone: { [DRONE]: { pilot: { data: p, receivedAt: Date.now() } } } as never,
  });
}

/** The canvas sits at (0, 0) with no measured size, so its centre pixel is
 *  (0, 0) and a click `(x, y)` px away lands `y / zoom` m south and `x / zoom`
 *  m east of the drone at (4 N, −2 E). */
const CLICK = { x: 30, y: 20 };
const NORTH = 4 - CLICK.y / DEFAULT_LOCAL_ZOOM; // 2 m
const EAST = -2 + CLICK.x / DEFAULT_LOCAL_ZOOM; // 1 m

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  return container.querySelector("canvas")!;
}

describe("LocalFrameMap point pick", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", undefined);
    useDroneStore.setState({ connectionState: "disconnected", armState: "disarmed", flightMode: "UNKNOWN" } as never);
    useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
    useGuidedStore.setState({ confirmPending: null });
    useLaunchRequestStore.setState({ pending: null });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useNavStreamStore.setState({ byDrone: {} });
    useGpsOriginStore.getState().clear(DRONE);
  });

  it("right-click with the pilot offering a goto opens Fly here at the converted point", () => {
    setPilot(flying);
    const { container } = render(<LocalFrameMap droneId={DRONE} compact />);
    fireEvent.contextMenu(canvasOf(container), { clientX: CLICK.x, clientY: CLICK.y, button: 2 });

    const pending = useGuidedStore.getState().confirmPending;
    expect(pending).not.toBeNull();
    const [lat, lon] = nedToLatLon(ORIGIN, NORTH, EAST);
    expect(pending).toEqual({ droneId: DRONE, lat, lon, screenX: CLICK.x, screenY: CLICK.y });
    // 2 m north, 1 m east of the origin on a 6 371 km sphere.
    expect(pending!.lat).toBeCloseTo(ORIGIN.lat + (2 / 6_371_000) * (180 / Math.PI), 9);
    expect(pending!.lon).toBeCloseTo(
      ORIGIN.lon + (1 / (6_371_000 * Math.cos((ORIGIN.lat * Math.PI) / 180))) * (180 / Math.PI),
      9,
    );
    expect(useLaunchRequestStore.getState().pending).toBeNull();
  });

  it("a touch held for map_long_press_ms opens Fly here at the converted point", () => {
    vi.useFakeTimers();
    setPilot(flying);
    const { container } = render(<LocalFrameMap droneId={DRONE} compact />);
    fireEvent.pointerDown(canvasOf(container), {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: CLICK.x,
      clientY: CLICK.y,
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
    expect(useGuidedStore.getState().confirmPending).toBeNull();
    act(() => vi.advanceTimersByTime(1));

    const [lat, lon] = nedToLatLon(ORIGIN, NORTH, EAST);
    expect(useGuidedStore.getState().confirmPending).toEqual({
      droneId: DRONE,
      lat,
      lon,
      screenX: CLICK.x,
      screenY: CLICK.y,
    });
  });

  it("a touch that moves is a pan, not a long-press", () => {
    vi.useFakeTimers();
    setPilot(flying);
    const { container } = render(<LocalFrameMap droneId={DRONE} compact />);
    const canvas = canvasOf(container);
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 40, clientY: 0 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(useGuidedStore.getState().confirmPending).toBeNull();
  });

  it("a ground long-press with the pilot advertising goto requests Launch at the point", () => {
    vi.useFakeTimers();
    setPilot(grounded);
    const { container } = render(<LocalFrameMap droneId={DRONE} compact />);
    fireEvent.pointerDown(canvasOf(container), {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: CLICK.x,
      clientY: CLICK.y,
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));

    const [lat, lon] = nedToLatLon(ORIGIN, NORTH, EAST);
    expect(useLaunchRequestStore.getState().pending).toMatchObject({ droneId: DRONE, lat, lon, north: NORTH, east: EAST });
    expect(useGuidedStore.getState().confirmPending).toBeNull();
    expect(useLaunchRequestStore.getState().consume()).toMatchObject({ north: 2, east: 1 });
    expect(useLaunchRequestStore.getState().pending).toBeNull();
  });

  it("offers nothing without a live pilot or a guided FC mode", () => {
    const { container } = render(<LocalFrameMap droneId={DRONE} compact />);
    fireEvent.contextMenu(canvasOf(container), { clientX: CLICK.x, clientY: CLICK.y, button: 2 });
    expect(useGuidedStore.getState().confirmPending).toBeNull();
    expect(useLaunchRequestStore.getState().pending).toBeNull();
  });
});
