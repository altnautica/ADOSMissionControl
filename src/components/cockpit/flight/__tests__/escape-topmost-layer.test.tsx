/**
 * @license GPL-3.0-only
 *
 * One Escape closes only the topmost layer: with the status pill's list or
 * the Menu open, the key closes that layer and never reaches the page's own
 * Escape handler (which leaves full screen). With nothing open, Escape still
 * reaches it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../CameraSheet", () => ({ CameraPanel: () => <div data-testid="camera-panel" /> }));
vi.mock("../../StickControlChip", () => ({ StickControlChip: () => <div data-testid="stick-control" /> }));
vi.mock("../../PreflightSheet", () => ({ PREFLIGHT_SHEET: "preflight", PreflightMenuRow: () => null, PreflightSheet: () => null }));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightMenu } from "../FlightMenu";
import { StatusPill } from "../StatusPill";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { useFlightSheetStore } from "../flight-sheet";

/** Stands in for the shell's full-screen Escape: a bubble listener on window. */
function shellEscape() {
  const leave = vi.fn();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") leave();
  };
  window.addEventListener("keydown", onKey);
  return { leave, dispose: () => window.removeEventListener("keydown", onKey) };
}

afterEach(() => {
  cleanup();
  useFlightSheetStore.setState({ open: null });
});

describe("Escape closes only the topmost layer", () => {
  it("closes the status pill list and leaves full screen on", () => {
    const shell = shellEscape();
    const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
    renderWithIntl(
      <FlightGridContext.Provider value={grid}>
        <div className="ados-cockpit">
          <StatusPill droneId="esc-pill" />
        </div>
      </FlightGridContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("status-pill"));
    expect(screen.getByTestId("status-pill-list")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("status-pill-list")).toBeNull();
    expect(shell.leave).not.toHaveBeenCalled();
    // Nothing open now: the next Escape reaches the shell.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(shell.leave).toHaveBeenCalledTimes(1);
    shell.dispose();
  });

  it("closes the Menu and leaves full screen on", () => {
    const shell = shellEscape();
    const onClose = vi.fn();
    renderWithIntl(<FlightMenu droneId="esc-menu" hidden={new Set()} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shell.leave).not.toHaveBeenCalled();
    shell.dispose();
  });
});
