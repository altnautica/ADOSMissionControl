/**
 * @license GPL-3.0-only
 *
 * The bottom row's label mode comes from the row's own width: all five
 * readouts where they fit without touching, distance and height only below
 * that, so the labels never collide (760x480 in the Vision view included).
 */

import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { BottomRow } from "../BottomRow";
import { FlightGridContext } from "../flight-context";
import { BOTTOM_ROW_FULL_MIN_W, bottomRowLabels, flightGrid, type FlightGrid } from "../flight-grid";

function gridAt(w: number, h: number, sidePanel = false): FlightGrid {
  return flightGrid({
    width: w,
    height: h,
    widthClass: widthClassFor(w, false),
    sidePanelWidth: sidePanel ? Math.round(Math.min(340, w * 0.4)) : 0,
  });
}

describe("bottom row label mode", () => {
  it("is decided by the row's width against the full-row minimum", () => {
    for (const [w, h, side] of [
      [580, 360, false],
      [760, 480, false],
      [760, 480, true],
      [900, 600, false],
      [915, 412, false],
      [1280, 800, false],
      [1280, 800, true],
      [1920, 1080, false],
      [412, 915, false],
    ] as const) {
      const g = gridAt(w, h, side);
      const row = g.zones.bottom_row!;
      const want = row.w >= BOTTOM_ROW_FULL_MIN_W * g.scale ? "full" : "distance_only";
      expect(bottomRowLabels(g), `${w}x${h}${side ? " vision" : ""}`).toBe(want);
    }
  });

  it("drops to distance and height where five readouts would collide", () => {
    expect(bottomRowLabels(gridAt(760, 480, true))).toBe("distance_only");
    expect(bottomRowLabels(gridAt(580, 360))).toBe("distance_only");
    expect(bottomRowLabels(gridAt(412, 915))).toBe("distance_only");
    expect(bottomRowLabels(gridAt(1280, 800))).toBe("full");
    expect(bottomRowLabels(gridAt(1920, 1080))).toBe("full");
  });
});

describe("bottom row readouts", () => {
  afterEach(cleanup);

  function mount(g: FlightGrid) {
    return renderWithIntl(createElement(FlightGridContext.Provider, { value: g }, createElement(BottomRow, { droneId: "row-labels" })));
  }

  it("shows D and H only at 760x480 in the Vision view", () => {
    mount(gridAt(760, 480, true));
    const row = document.querySelector("[data-zone='bottom_row']")!;
    expect(row.getAttribute("data-labels")).toBe("distance_only");
    expect(screen.getByTestId("fs-row-d")).toBeTruthy();
    expect(screen.getByTestId("fs-row-h")).toBeTruthy();
    for (const key of ["hs", "vs", "agl"]) expect(screen.queryByTestId(`fs-row-${key}`), key).toBeNull();
  });

  it("shows all five readouts on a wide row", () => {
    mount(gridAt(1280, 800));
    for (const key of ["d", "h", "hs", "vs", "agl"]) expect(screen.getByTestId(`fs-row-${key}`), key).toBeTruthy();
  });
});
