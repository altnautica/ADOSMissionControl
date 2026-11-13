/**
 * @license GPL-3.0-only
 *
 * In the Split view the map pane's body (the map with its own header,
 * controls and banner) starts below the top bar, so the bar never clips it.
 * The Map view's pane already sits below the bar and is not shifted.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { widthClassFor } from "@/lib/cockpit/width-class";
import { FlightGridContext } from "../flight-context";
import { FlightMapFrame, splitMapChromeInset } from "../FlightVideoFrame";
import { flightGrid, splitMapRect } from "../flight-grid";

function gridAt(w: number, h: number) {
  return flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false) });
}

afterEach(() => cleanup());

describe("split map pane below the top bar", () => {
  it("starts the pane body at the top bar's bottom edge at 1280x800", () => {
    const grid = gridAt(1280, 800);
    const bar = grid.zones.top_bar!;
    const pane = splitMapRect(grid);
    expect(pane.y + splitMapChromeInset(grid)).toBe(bar.y + bar.h);
    expect(splitMapChromeInset(grid)).toBeGreaterThan(0);

    render(
      <FlightGridContext.Provider value={grid}>
        <FlightMapFrame main={false}>
          <div data-testid="map" />
        </FlightMapFrame>
      </FlightGridContext.Provider>,
    );
    const body = screen.getByTestId("fs-map-pane-body");
    expect(body.contains(screen.getByTestId("map"))).toBe(true);
    expect(body.style.top).toBe(`${bar.y + bar.h - pane.y}px`);
  });

  it("does not shift the Map view's pane", () => {
    const grid = gridAt(1280, 800);
    render(
      <FlightGridContext.Provider value={grid}>
        <FlightMapFrame main>{null}</FlightMapFrame>
      </FlightGridContext.Provider>,
    );
    expect(screen.getByTestId("fs-map-pane-body").style.top).toBe("0px");
  });
});
