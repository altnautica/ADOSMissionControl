/**
 * @license GPL-3.0-only
 *
 * The cockpit's controller chip asks for a button press before any pad has
 * reported, reads "not supported" for a non-standard pad (which never streams
 * sticks), and shows the first-connect tour once per pad id.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ControllerChip } from "../CockpitTopActions";
import { usePadStatusStore, type PadStatus } from "@/lib/input/pad-status";
import { useInputStore } from "@/stores/input-store";
import { useControlsStore } from "@/stores/controls-store";

function pad(p: Partial<PadStatus>): void {
  usePadStatusStore.getState().set({
    seen: false,
    connected: false,
    name: null,
    usable: false,
    needsCalibration: false,
    ...p,
  });
}

afterEach(() => {
  cleanup();
  pad({});
  useInputStore.setState({ gamepadId: null });
  useControlsStore.setState({ tourSeen: {} });
});

describe("cockpit controller chip", () => {
  it("asks for a button press before any pad has reported", () => {
    pad({});
    render(<ControllerChip />);
    expect(screen.getByTestId("cockpit-controller-chip").textContent).toBe(
      "Press any button on the controller",
    );
  });

  it("reads not supported for a non-standard pad, with no calibrate promise", () => {
    pad({ seen: true, connected: true, needsCalibration: true });
    render(<ControllerChip />);
    const text = screen.getByTestId("cockpit-controller-chip").textContent ?? "";
    expect(text).toBe("Controller layout not supported");
    expect(screen.queryByTestId("controls-tour")).toBeNull();
  });

  it("shows the tour on a pad's first connect, once per pad", () => {
    pad({ seen: true, connected: true, usable: true, name: "Wireless Controller" });
    useInputStore.setState({ gamepadId: "pad-1" });
    render(<ControllerChip />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByTestId("controls-tour")).toBeNull();
    expect(useControlsStore.getState().tourSeen["pad-1"]).toBe(true);
  });
});
