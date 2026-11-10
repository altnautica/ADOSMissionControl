/**
 * @license GPL-3.0-only
 *
 * The top bar's controller cell in the shared spec's words: "no controller"
 * before any pad has reported this session, a request for a button press once
 * one has and is gone, "Pad" for a usable pad (named in its label) and "Not
 * standard" for a pad whose layout never streams sticks.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { ControllerCell } from "../TopBarCells";
import { usePadStatusStore, type PadStatus } from "@/lib/input/pad-status";

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
});

describe("top bar controller cell", () => {
  it("reads no controller before any pad has reported this session", () => {
    pad({});
    renderWithIntl(<ControllerCell />);
    const cell = screen.getByTestId("cockpit-controller-chip");
    expect(cell.textContent).toBe("No controller");
    expect(cell.getAttribute("data-pad")).toBe("none");
  });

  it("asks for a button press once a pad has reported and is gone", () => {
    pad({ seen: true, connected: false });
    renderWithIntl(<ControllerCell />);
    const cell = screen.getByTestId("cockpit-controller-chip");
    expect(cell.textContent).toBe("Press any button on the controller");
    expect(cell.getAttribute("data-pad")).toBe("seen");
  });

  it("reads not standard for a pad whose layout never streams sticks", () => {
    pad({ seen: true, connected: true, needsCalibration: true });
    renderWithIntl(<ControllerCell />);
    expect(screen.getByTestId("cockpit-controller-chip").textContent).toBe("Not standard");
  });

  it("reads Pad for a usable pad, named without the browser's id decorations", () => {
    pad({
      seen: true,
      connected: true,
      usable: true,
      name: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
    });
    renderWithIntl(<ControllerCell />);
    const cell = screen.getByTestId("cockpit-controller-chip");
    expect(cell.textContent).toBe("Pad");
    expect(cell.getAttribute("aria-label")).toBe("Controller Wireless Controller: Pad");
  });
});
