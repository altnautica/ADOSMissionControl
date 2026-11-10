/**
 * @license GPL-3.0-only
 *
 * The status pill's alert list renders at the flight screen's root, below
 * the top bar, never inside the bar (whose box clips its content), and a tap
 * on a row inside the list keeps it open.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { useFlightSheetStore } from "../flight-sheet";
import { StatusPill } from "../StatusPill";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

afterEach(() => {
  cleanup();
  useFlightSheetStore.setState({ open: null });
});

function mount() {
  const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
  return renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <div className="ados-cockpit" data-testid="flight-screen">
        <div className="fs-bar" data-zone="top_bar">
          <div className="fs-bar-main" data-testid="bar-main">
            <StatusPill droneId="pill-portal" />
          </div>
        </div>
      </div>
    </FlightGridContext.Provider>,
  );
}

describe("status pill list", () => {
  it("opens at the flight screen's root, outside the clipping top bar", () => {
    mount();
    fireEvent.click(screen.getByTestId("status-pill"));
    const list = screen.getByTestId("status-pill-list");
    expect(screen.getByTestId("bar-main").contains(list)).toBe(false);
    expect(list.parentElement).toBe(screen.getByTestId("flight-screen"));
    expect(list.style.position).toBe("absolute");
    expect(list.style.top).toContain("--fs-bar-b");
  });

  it("stays open when a row inside the list is pressed", () => {
    mount();
    fireEvent.click(screen.getByTestId("status-pill"));
    const list = screen.getByTestId("status-pill-list");
    fireEvent.pointerDown(list.firstElementChild ?? list);
    expect(screen.queryByTestId("status-pill-list")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("status-pill-list")).toBeNull();
  });
});
