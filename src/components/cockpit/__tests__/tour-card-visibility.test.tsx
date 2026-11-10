/**
 * @license GPL-3.0-only
 *
 * The controller tour card on the flight screen: on the ground only, once
 * per device, with Skip / Close / Done marking it seen, driveable by the pad
 * (D-pad + Cross) and the keyboard, and holding the tips back while shown.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pilot: null as null | { armed: boolean; landed: boolean },
  /** When the pilot frame arrived; null means just now. */
  receivedAt: null as number | null,
}));

vi.mock("@/lib/cockpit/use-pilot-state", () => ({
  usePilotState: () => ({
    pilot: mocks.pilot,
    receivedAt: mocks.pilot ? (mocks.receivedAt ?? Date.now()) : null,
  }),
}));

import { ControllerTourCard, tourAirborne } from "@/components/cockpit/ControllerTourCard";
import { flightGrid } from "@/components/cockpit/flight/flight-grid";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";
import { useInputStore } from "@/stores/input-store";

function press(control: string) {
  const down: boolean[] = [];
  down[WEB_BUTTON_INDEX[control]] = true;
  act(() => useInputStore.setState({ buttons: down }));
  act(() => useInputStore.setState({ buttons: [] }));
}

beforeEach(() => {
  mocks.pilot = null;
  mocks.receivedAt = null;
  usePadStatusStore.getState().set({ seen: true, connected: true, usable: true, needsCalibration: false, name: "Pad" });
  useControlsStore.setState({ tourSeen: false, tourVisible: false });
  useDroneStore.setState({ armState: "disarmed" });
  useInputStore.setState({ buttons: [] });
});

afterEach(() => {
  cleanup();
  usePadStatusStore.getState().set({ seen: false, connected: false, usable: false, needsCalibration: false, name: null });
});

describe("controller tour card", () => {
  it("shows on the ground and holds the tips back", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    expect(screen.getByTestId("controls-tour").textContent).toContain("Sticks");
    expect(useControlsStore.getState().tourVisible).toBe(true);
  });

  it("is hidden while airborne (pilot armed and not landed)", () => {
    mocks.pilot = { armed: true, landed: false };
    render(<ControllerTourCard droneId="drone-1" />);
    expect(screen.queryByTestId("controls-tour")).toBeNull();
    expect(useControlsStore.getState().tourVisible).toBe(false);
  });

  it("is hidden while the heartbeat reads armed and there is no pilot state", () => {
    useDroneStore.setState({ armState: "armed" });
    render(<ControllerTourCard droneId="drone-1" />);
    expect(screen.queryByTestId("controls-tour")).toBeNull();
  });

  it("reads a fresh pilot over the heartbeat: armed on the ground still shows", () => {
    const now = 10_000;
    expect(tourAirborne({ armed: true, landed: true }, now - 100, true, now)).toBe(false);
    expect(tourAirborne({ armed: true, landed: false }, now - 100, false, now)).toBe(true);
    expect(tourAirborne(null, null, true, now)).toBe(true);
    expect(tourAirborne(null, null, false, now)).toBe(false);
  });

  it("falls back to the heartbeat once the pilot frame is stale", () => {
    const now = 10_000;
    expect(tourAirborne({ armed: true, landed: true }, now - 5000, true, now)).toBe(true);
    expect(tourAirborne({ armed: true, landed: false }, now - 5000, false, now)).toBe(false);
  });

  it("is hidden in flight when a frozen pilot frame still says landed", () => {
    mocks.pilot = { armed: true, landed: true };
    mocks.receivedAt = Date.now() - 60_000;
    useDroneStore.setState({ armState: "armed" });
    render(<ControllerTourCard droneId="drone-1" />);
    expect(screen.queryByTestId("controls-tour")).toBeNull();
    expect(useControlsStore.getState().tourVisible).toBe(false);
  });

  it("shows armed on the ground while the pilot frame is fresh", () => {
    mocks.pilot = { armed: true, landed: true };
    useDroneStore.setState({ armState: "armed" });
    render(<ControllerTourCard droneId="drone-1" />);
    expect(screen.getByTestId("controls-tour")).toBeTruthy();
  });

  it("is hidden once seen", () => {
    useControlsStore.setState({ tourSeen: true });
    render(<ControllerTourCard droneId="drone-1" />);
    expect(screen.queryByTestId("controls-tour")).toBeNull();
  });

  it("Skip marks it seen", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(useControlsStore.getState().tourSeen).toBe(true);
    expect(screen.queryByTestId("controls-tour")).toBeNull();
    expect(useControlsStore.getState().tourVisible).toBe(false);
  });

  it("Close marks it seen", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useControlsStore.getState().tourSeen).toBe(true);
  });

  it("Next walks the cards and Done marks it seen", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("controls-tour").dataset.card).toBe("safety");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(useControlsStore.getState().tourSeen).toBe(true);
  });

  it("the pad drives it: Cross presses Next, D-pad left then Cross skips", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    press("cross");
    expect(screen.getByTestId("controls-tour").dataset.card).toBe("safety");
    press("dpad_left");
    expect(screen.getByTestId("controls-tour-skip").dataset.focused).toBe("true");
    press("cross");
    expect(useControlsStore.getState().tourSeen).toBe(true);
  });

  it("Escape closes it from the keyboard", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    fireEvent.keyDown(screen.getByTestId("controls-tour"), { key: "Escape" });
    expect(useControlsStore.getState().tourSeen).toBe(true);
  });

  it("sits right of the left column, so it covers neither it nor STOP", () => {
    render(<ControllerTourCard droneId="drone-1" />);
    const grid = flightGrid({ width: 1280, height: 720, widthClass: "expanded" });
    const col = grid.zones.left_column!;
    const left = parseFloat(screen.getByTestId("controls-tour").style.left);
    expect(left).toBeGreaterThanOrEqual(col.x + col.w);
  });
});
