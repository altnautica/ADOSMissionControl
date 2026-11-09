/**
 * @license GPL-3.0-only
 *
 * The top bar's controller cell asks for a button press before any pad has
 * reported and reads "not supported" for a non-standard pad (which never
 * streams sticks); the first-connect tour shows once per pad id.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { ControllerCell, ControllerTour } from "../TopBarCells";
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

describe("top bar controller cell", () => {
  it("asks for a button press before any pad has reported", () => {
    pad({});
    renderWithIntl(<ControllerCell />);
    expect(screen.getByTestId("cockpit-controller-chip").textContent).toBe(
      "Press any button on the controller",
    );
  });

  it("reads not supported for a non-standard pad, with no calibrate promise and no tour", () => {
    pad({ seen: true, connected: true, needsCalibration: true });
    useInputStore.setState({ gamepadId: "pad-1" });
    renderWithIntl(
      <>
        <ControllerCell />
        <ControllerTour />
      </>,
    );
    expect(screen.getByTestId("cockpit-controller-chip").textContent).toBe("Controller layout not supported");
    expect(screen.queryByTestId("controls-tour")).toBeNull();
  });

  it("shows the product name without the browser's id decorations", () => {
    pad({
      seen: true,
      connected: true,
      usable: true,
      name: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
    });
    renderWithIntl(<ControllerCell />);
    expect(screen.getByTestId("cockpit-controller-chip").textContent).toBe("Wireless Controller");
  });

  it("shows the tour on a pad's first connect, once per pad", () => {
    pad({ seen: true, connected: true, usable: true, name: "Wireless Controller" });
    useInputStore.setState({ gamepadId: "pad-1" });
    renderWithIntl(<ControllerTour />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByTestId("controls-tour")).toBeNull();
    expect(useControlsStore.getState().tourSeen["pad-1"]).toBe(true);
  });
});
